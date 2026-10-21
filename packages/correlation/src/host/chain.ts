/**
 * Following one chain through whatever the installed integrations know.
 *
 * The walk is deliberately dumb, because the links are data: a reference names
 * a kind and an identity, whichever provider resolves that kind answers with a
 * fact for it, and that fact's own references are what comes next. Nothing here
 * knows what a merge request is — the vocabulary belongs to
 * `dsh-integration-host` and the answers belong to the providers.
 *
 * What the walk owes the reader is honesty about where it stopped. A hop no
 * installed integration resolves, one a provider refused, and one that simply
 * found nothing are three different sentences, and all three are reported
 * rather than silently dropped.
 */

import type {
	CorrelationFact,
	CorrelationKind,
	CorrelationRef,
} from "dsh-integration-host/correlation";
import type { ChainBreak, ChainHop, ChainReport } from "../shared/meta";
import { anchorFor } from "./anchor";

/** What the walk reads from the correlation registry. */
export interface ChainResolver {
	readonly providers: readonly { readonly provider: string }[];
	entryOf(provider: string): CorrelationKind | undefined;
	canResolve(kind: CorrelationKind): boolean;
	resolve(ref: CorrelationRef): Promise<readonly CorrelationFact[]>;
}

/** What one walk was asked for. */
export interface ChainRequest {
	/** The tool call the chain belongs to; the card's identity. */
	readonly callId: string;
	/** The provider to start from, as the user names it. */
	readonly provider: string;
	/** The provider's own identifier, in whatever spelling the user typed. */
	readonly ref: string;
}

/** How far and how wide one walk may go. */
export interface ChainLimits {
	/** The deepest a reference may sit from the anchor. */
	readonly depth: number;
	/** The most facts one chain will hold. */
	readonly facts: number;
}

/** The bounds a chain is walked under. */
export const DEFAULT_CHAIN_LIMITS: ChainLimits = { depth: 4, facts: 40 };

/** What a reference is called when nobody resolved it. */
const KIND_LABELS: Record<CorrelationKind, string> = {
	error: "Error",
	commit: "Commit",
	change: "Change request",
	task: "Ticket",
};

/**
 * A reference's identity, for deduplication.
 *
 * Two providers naming the same commit, or the same merge request twice from two
 * commits, is one hop on the card; this is what makes them the same.
 */
export const refKey = (ref: CorrelationRef): string => {
	switch (ref.kind) {
		case "error":
			return `error:${ref.id}`;
		case "commit":
			return `commit:${ref.sha}@${ref.url ?? ref.repository ?? ""}`;
		case "change":
			return `change:${ref.repository}!${ref.number}`;
		case "task":
			return `task:${ref.key}`;
	}
};

/** What the card calls a reference, as the provider that named it wrote it. */
export const refLabel = (ref: CorrelationRef): string =>
	ref.label ?? KIND_LABELS[ref.kind];

/** What one walk answers with, once it stops. */
const report = (
	request: ChainRequest,
	anchor: CorrelationFact | undefined,
	hops: readonly ChainHop[],
	breaks: readonly ChainBreak[],
): ChainReport => ({
	callId: request.callId,
	title: anchor?.title ?? request.ref,
	provider: anchor?.provider ?? request.provider,
	hops,
	breaks,
});

/**
 * Walk one chain from an anchor, depth first.
 *
 * Depth first, taking each hop's first reference before its siblings, is what
 * makes the answer read as *a* chain — an error, the commit behind it, the merge
 * request that commit belongs to, the ticket that names — rather than as a layer
 * of everything one step away. A second branch of the same hop still appears, one
 * branch later.
 * @param resolver - the correlation registry, or anything shaped like it.
 * @param request - the anchor to start from.
 * @param limits - how far and how wide to go; the defaults walk a whole chain.
 * @returns every hop that answered, in the order the chain reaches them, and
 *   every hop that did not, with the reason.
 */
export const buildChain = async (
	resolver: ChainResolver,
	request: ChainRequest,
	limits: ChainLimits = DEFAULT_CHAIN_LIMITS,
): Promise<ChainReport> => {
	const entry = resolver.entryOf(request.provider);

	if (entry === undefined)
		throw new Error(
			`no integration named "${request.provider}" is installed; available: ${
				resolver.providers.map((item) => item.provider).join(", ") || "none"
			}`,
		);

	const seenRefs = new Set<string>();
	const seenFacts = new Set<string>();
	const hops: ChainHop[] = [];
	const breaks: ChainBreak[] = [];
	const pending: { ref: CorrelationRef; depth: number }[] = [
		{ ref: anchorFor(entry, request.ref), depth: 0 },
	];
	const onward: CorrelationRef[] = [];
	let anchor: CorrelationFact | undefined;

	while (pending.length > 0) {
		const next = pending.pop();
		if (next === undefined) break;

		const key = refKey(next.ref);

		if (seenRefs.has(key)) continue;
		seenRefs.add(key);

		if (!resolver.canResolve(next.ref.kind)) {
			breaks.push({
				kind: next.ref.kind,
				label: refLabel(next.ref),
				reason: "no installed integration resolves this",
			});

			continue;
		}

		let facts: readonly CorrelationFact[];

		try {
			facts = await resolver.resolve(next.ref);
		} catch (error) {
			breaks.push({
				kind: next.ref.kind,
				label: refLabel(next.ref),
				reason: (error as Error).message,
			});

			continue;
		}

		if (facts.length === 0) {
			breaks.push({
				kind: next.ref.kind,
				label: refLabel(next.ref),
				reason: "nothing found",
			});

			continue;
		}

		for (const fact of facts) {
			if (seenFacts.has(fact.id)) continue;

			if (hops.length >= limits.facts) {
				breaks.push({
					kind: fact.kind,
					label: fact.label,
					reason: "the chain is longer than this answer follows",
				});

				continue;
			}

			seenFacts.add(fact.id);
			if (anchor === undefined) anchor = fact;

			hops.push({
				id: fact.id,
				kind: fact.kind,
				label: fact.label,
				provider: fact.provider,
				title: fact.title,
				...(fact.url === undefined ? {} : { url: fact.url }),
				...(fact.meta === undefined ? {} : { meta: fact.meta }),
				depth: next.depth,
			});

			for (const reference of fact.references ?? []) {
				if (next.depth + 1 > limits.depth) {
					breaks.push({
						kind: reference.kind,
						label: refLabel(reference),
						reason: "deeper than this answer follows",
					});

					continue;
				}

				onward.push(reference);
			}
		}

		// A stack pops the last push first, so the first reference of this hop is
		// the next one walked.
		for (const reference of onward.reverse())
			pending.push({ ref: reference, depth: next.depth + 1 });

		onward.length = 0;
	}

	return report(request, anchor, hops, breaks);
};

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
 * rather than silently dropped — with the class they belong to, the level they
 * sit at, and the hop that pointed at them, so a branch reads as a branch.
 */

import type {
	CorrelationFact,
	CorrelationKind,
	CorrelationRef,
} from "dsh-integration-host/correlation";
import type {
	ChainBreak,
	ChainBreakCause,
	ChainCoverage,
	ChainHop,
	ChainReport,
} from "../shared/meta";
import { anchorFor } from "./anchor";

/** One provider, as the walk reads it from the registry. */
export interface ChainProvider {
	readonly provider: string;
	/** The kind a chain starts from for this provider, when it says. */
	readonly entry?: CorrelationKind;
	/** The kinds this provider resolves, when it says. */
	readonly resolves?: readonly CorrelationKind[];
}

/** What the walk reads from the correlation registry. */
export interface ChainResolver {
	readonly providers: readonly ChainProvider[];
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

/**
 * What an anchor is called before any provider has answered for it.
 *
 * The card is titled by whatever the user named, so an id that resolved to
 * nothing must still read as an id — not as the raw text, which may be a whole
 * pasted link.
 */
export const describeRef = (ref: CorrelationRef): string => {
	switch (ref.kind) {
		case "error":
			return `${KIND_LABELS.error} ${ref.id}`;
		case "commit":
			return `${KIND_LABELS.commit} ${ref.sha}`;
		case "change":
			return `${KIND_LABELS.change} ${ref.repository}!${ref.number}`;
		case "task":
			return `${KIND_LABELS.task} ${ref.key}`;
	}
};

/**
 * Which class a provider's refusal belongs to.
 *
 * Providers speak in their own words, and the words a refusal uses for "sign in
 * again", "this token has no access", and "the request failed" differ per
 * integration. This reads the class out of that wording rather than asking each
 * integration to declare one, which would be a change to the shared contract.
 */
const causeOfRefusal = (error: unknown): ChainBreakCause => {
	const text = (
		error instanceof Error ? error.message : String(error)
	).toLowerCase();

	return /auth|sign in|sign-in|token|credential|permission|forbidden|unauthori[sz]ed|access denied|401|403/u.test(
		text,
	)
		? "auth"
		: "refused";
};

/** One reference the walk has yet to resolve. */
interface Pending {
	readonly ref: CorrelationRef;
	readonly depth: number;
	/** The hop whose reference this is; absent for the anchor itself. */
	readonly parent?: string;
}

/** What one walk answers with, once it stops. */
const report = (
	request: ChainRequest,
	anchorRef: CorrelationRef,
	anchor: CorrelationFact | undefined,
	hops: readonly ChainHop[],
	breaks: readonly ChainBreak[],
	limits: ChainLimits,
	coverage: readonly ChainCoverage[],
): ChainReport => ({
	callId: request.callId,
	title: anchor?.title ?? describeRef(anchorRef),
	provider: anchor?.provider ?? request.provider,
	hops,
	breaks,
	limits: { depth: limits.depth, facts: limits.facts },
	...(coverage.length === 0 ? {} : { coverage }),
});

/**
 * Walk one chain from an anchor, depth first.
 *
 * Depth first, taking each hop's first reference before its siblings, is what
 * makes the answer read as *a* chain — an error, the commit behind it, the merge
 * request that commit belongs to, the ticket that names — rather than as a layer
 * of everything one step away. A second branch of the same hop still appears, one
 * branch later, and each hop and break carries its level and parent so both
 * readers can draw the branch the walk actually took.
 * @param resolver - the correlation registry, or anything shaped like it.
 * @param request - the anchor to start from.
 * @param limits - how far and how wide to go; the defaults walk a whole chain.
 * @returns every hop that answered, in the order the chain reaches them, and
 *   every hop that did not, with its class and the hop that pointed at it.
 */
export const buildChain = async (
	resolver: ChainResolver,
	request: ChainRequest,
	limits: ChainLimits = DEFAULT_CHAIN_LIMITS,
): Promise<ChainReport> => {
	const provider = resolver.providers.find(
		(item) => item.provider === request.provider,
	);
	const entry = resolver.entryOf(request.provider);

	if (entry === undefined)
		throw new Error(
			`no integration named "${request.provider}" is installed; available: ${
				resolver.providers.map((item) => item.provider).join(", ") || "none"
			}`,
		);

	const anchorRef = anchorFor(
		{
			provider: request.provider,
			entry,
			resolves: provider?.resolves ?? [entry],
		},
		request.ref,
	);
	const seenRefs = new Set<string>();
	const seenFacts = new Set<string>();
	const hops: ChainHop[] = [];
	const breaks: ChainBreak[] = [];
	const pending: Pending[] = [{ ref: anchorRef, depth: 0 }];
	const onward: Pending[] = [];
	let anchor: CorrelationFact | undefined;

	/** Record one unreachable reference, with its class and what pointed at it. */
	const stop = (
		next: Pending,
		cause: ChainBreakCause,
		reason: string,
		named?: { readonly kind: CorrelationKind; readonly label: string },
	): void => {
		breaks.push({
			kind: named?.kind ?? next.ref.kind,
			label: named?.label ?? refLabel(next.ref),
			reason,
			cause,
			depth: next.depth,
			...(next.parent === undefined ? {} : { parent: next.parent }),
		});
	};

	while (pending.length > 0) {
		const next = pending.pop();
		if (next === undefined) break;

		const key = refKey(next.ref);

		if (seenRefs.has(key)) continue;
		seenRefs.add(key);

		if (!resolver.canResolve(next.ref.kind)) {
			stop(next, "missing", "no installed integration resolves this");

			continue;
		}

		let facts: readonly CorrelationFact[];

		try {
			facts = await resolver.resolve(next.ref);
		} catch (error) {
			stop(
				next,
				causeOfRefusal(error),
				error instanceof Error ? error.message : String(error),
			);

			continue;
		}

		if (facts.length === 0) {
			stop(next, "empty", "the provider knows no such reference");

			continue;
		}

		for (const fact of facts) {
			if (seenFacts.has(fact.id)) continue;

			if (hops.length >= limits.facts) {
				stop(next, "limit", `the chain is capped at ${limits.facts} hops`, {
					kind: fact.kind,
					label: fact.label,
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
				...(next.parent === undefined ? {} : { parent: next.parent }),
			});

			for (const reference of fact.references ?? []) {
				if (next.depth + 1 > limits.depth) {
					stop(
						{
							ref: reference,
							depth: next.depth + 1,
							parent: fact.id,
						},
						"limit",
						`the chain is capped at ${limits.depth} levels below the anchor`,
					);

					continue;
				}

				onward.push({
					ref: reference,
					depth: next.depth + 1,
					parent: fact.id,
				});
			}
		}

		// A stack pops the last push first, so the first reference of this hop is
		// the next one walked.
		for (const reference of onward.reverse()) pending.push(reference);

		onward.length = 0;
	}

	return report(
		request,
		anchorRef,
		anchor,
		hops,
		breaks,
		limits,
		coverageOf(resolver, hops, breaks),
	);
};

/** The kinds more than one installed provider could have answered. */
const coverageOf = (
	resolver: ChainResolver,
	hops: readonly ChainHop[],
	breaks: readonly ChainBreak[],
): readonly ChainCoverage[] => {
	const touched = new Set<CorrelationKind>([
		...hops.map((hop) => hop.kind),
		...breaks.map((item) => item.kind),
	]);
	const answer: ChainCoverage[] = [];

	for (const kind of touched) {
		const providers = resolver.providers
			.filter((item) => (item.resolves ?? []).includes(kind))
			.map((item) => item.provider);

		if (providers.length < 2) continue;

		const answeredBy = hops.find((hop) => hop.kind === kind)?.provider;

		answer.push({
			kind,
			providers,
			...(answeredBy === undefined ? {} : { answeredBy }),
		});
	}

	return answer;
};

/**
 * What a correlation is, on both sides of the wire.
 *
 * The host half walks the chain the installed integrations answer with, records
 * it as the `correlate` tool result's `presentationMeta`, and the browser half
 * narrows it out of the persisted result to draw the card under the agent's
 * answer. Both halves import these types and each bundle inlines its own copy —
 * a type-only contract, not shared runtime state.
 *
 * The vocabulary of kinds belongs to `dsh-integration-host`, because the host
 * half that fills a chain reads it from a provider; the browser half only reads
 * the words a provider already chose.
 */

import type { CorrelationKind } from "dsh-integration-host/correlation";

export type { CorrelationKind };

/** One thing the chain reached, as the card shows it. */
export interface ChainHop {
	/** Stable across the chain: what two providers' answers are deduplicated by. */
	readonly id: string;
	readonly kind: CorrelationKind;
	/** What the card calls this hop, such as `Suspect commit`. */
	readonly label: string;
	/** The provider that answered, such as `GitLab`. */
	readonly provider: string;
	readonly title: string;
	readonly url?: string;
	/** One supporting detail, such as `opened · Ada Lovelace`. */
	readonly meta?: string;
	/** How many references away from the anchor this hop sits. */
	readonly depth: number;
}

/**
 * A hop the chain could not follow.
 *
 * The three reasons read differently and are kept apart: nothing installed
 * resolves that kind, the provider that does was asked and refused, or it
 * answered that it knows no such thing.
 */
export interface ChainBreak {
	readonly kind: CorrelationKind;
	/** What the card calls the hop that was not followed. */
	readonly label: string;
	readonly reason: string;
}

/** One walked chain. */
export interface ChainReport {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	/** The anchor, as its own provider described it. */
	readonly title: string;
	/** The provider the chain started from, such as `Sentry`. */
	readonly provider: string;
	readonly hops: readonly ChainHop[];
	readonly breaks: readonly ChainBreak[];
}

/** The kinds this plugin will render; a card that cannot read one renders nothing. */
const KINDS: readonly CorrelationKind[] = ["error", "commit", "change", "task"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKind(value: unknown): value is CorrelationKind {
	return KINDS.includes(value as CorrelationKind);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Narrow one opaque record payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the chain, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool keeps a text
 *   result as the source of truth for the model.
 */
export function asChainReport(value: unknown): ChainReport | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (typeof value.title !== "string") return undefined;
	if (typeof value.provider !== "string") return undefined;
	if (!Array.isArray(value.hops) || !Array.isArray(value.breaks))
		return undefined;

	const hops: ChainHop[] = [];

	for (const candidate of value.hops) {
		if (!isRecord(candidate)) continue;
		if (typeof candidate.id !== "string") continue;
		if (typeof candidate.title !== "string") continue;
		if (!isKind(candidate.kind)) continue;

		hops.push({
			id: candidate.id,
			kind: candidate.kind,
			label:
				typeof candidate.label === "string" && candidate.label !== ""
					? candidate.label
					: candidate.kind,
			provider:
				typeof candidate.provider === "string" ? candidate.provider : "",
			title: candidate.title,
			...(optionalString(candidate.url) === undefined
				? {}
				: { url: optionalString(candidate.url) }),
			...(optionalString(candidate.meta) === undefined
				? {}
				: { meta: optionalString(candidate.meta) }),
			depth: typeof candidate.depth === "number" ? candidate.depth : 0,
		});
	}

	const breaks: ChainBreak[] = [];

	for (const candidate of value.breaks) {
		if (!isRecord(candidate)) continue;
		if (!isKind(candidate.kind)) continue;
		if (typeof candidate.reason !== "string") continue;

		breaks.push({
			kind: candidate.kind,
			label:
				typeof candidate.label === "string" && candidate.label !== ""
					? candidate.label
					: candidate.kind,
			reason: candidate.reason,
		});
	}

	return {
		callId: value.callId,
		title: value.title,
		provider: value.provider,
		hops,
		breaks,
	};
}

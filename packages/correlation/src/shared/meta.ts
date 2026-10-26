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
import {
	fallback,
	isRecord,
	list,
	literal,
	nonEmptyString,
	number,
	object,
	oneOf,
	optional,
	type Reader,
	required,
	string,
} from "dsh-integration-host/shape";

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
	/** The hop whose reference led here; absent for the anchor itself. */
	readonly parent?: string;
}

/**
 * Why a hop was not followed.
 *
 * The reason is the provider's own words; this is the class they belong to, so
 * a reader — and the model — can tell "nothing is installed" from "the account
 * lacks access" from "it simply knows no such thing" without parsing prose.
 */
export type ChainBreakCause =
	| "missing"
	| "auth"
	| "refused"
	| "empty"
	| "limit";

/** How one cause reads, on the card and in the model's text. */
export const BREAK_CAUSE_LABELS: Readonly<Record<ChainBreakCause, string>> = {
	missing: "no integration",
	auth: "access denied",
	refused: "provider refused",
	empty: "nothing found",
	limit: "capped",
};

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
	/** The class {@link reason} belongs to; absent on a payload from before it. */
	readonly cause?: ChainBreakCause;
	/** How far from the anchor the unreachable reference sits. */
	readonly depth: number;
	/** The hop it was referenced from; absent when the anchor itself broke. */
	readonly parent?: string;
}

/** A kind more than one installed integration could resolve. */
export interface ChainCoverage {
	readonly kind: CorrelationKind;
	/** Every installed provider that resolves the kind, in registration order. */
	readonly providers: readonly string[];
	/** The provider whose answer the chain used, when one answered. */
	readonly answeredBy?: string;
}

/** The bounds one walk stopped at, so the result can name them. */
export interface ChainLimitsView {
	/** The deepest a reference may sit from the anchor. */
	readonly depth: number;
	/** The most facts one chain holds. */
	readonly facts: number;
}

/** One walked chain. */
export interface ChainReport {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	/** The anchor, as its own provider described it — or as its id reads. */
	readonly title: string;
	/** The provider the chain started from, such as `Sentry`. */
	readonly provider: string;
	readonly hops: readonly ChainHop[];
	readonly breaks: readonly ChainBreak[];
	/** The caps this walk ran under. */
	readonly limits?: ChainLimitsView;
	/** Kinds more than one installed integration resolves, with who answered. */
	readonly coverage?: readonly ChainCoverage[];
}

/** The kinds this plugin will render; a card that cannot read one renders nothing. */
const kind = oneOf<CorrelationKind>(
	literal("error"),
	literal("commit"),
	literal("change"),
	literal("task"),
);

const cause = oneOf<ChainBreakCause>(
	literal("missing"),
	literal("auth"),
	literal("refused"),
	literal("empty"),
	literal("limit"),
);

/** A hop before its label falls back to the kind. */
type HopWire = Omit<ChainHop, "label"> & { readonly label?: string };

const hop = object<HopWire>({
	id: required(nonEmptyString),
	kind: required(kind),
	label: optional(nonEmptyString),
	provider: fallback(string, ""),
	title: required(string),
	url: optional(nonEmptyString),
	meta: optional(nonEmptyString),
	depth: fallback(number, 0),
	parent: optional(nonEmptyString),
});

/** A broken hop before its label falls back to the kind. */
type BreakWire = Omit<ChainBreak, "label"> & { readonly label?: string };

const chainBreak = object<BreakWire>({
	kind: required(kind),
	label: optional(nonEmptyString),
	reason: required(string),
	cause: optional(cause),
	depth: fallback(number, 0),
	parent: optional(nonEmptyString),
});

const coverage = object<ChainCoverage>({
	kind: required(kind),
	providers: fallback(list(string), []),
	answeredBy: optional(nonEmptyString),
});

const limits = object<ChainLimitsView>({
	depth: fallback(number, 0),
	facts: fallback(number, 0),
});

const readHop: Reader<ChainHop> = (value) => {
	const parsed = hop(value);

	return parsed === undefined
		? undefined
		: { ...parsed, label: parsed.label ?? parsed.kind };
};

const readBreak: Reader<ChainBreak> = (value) => {
	const parsed = chainBreak(value);

	return parsed === undefined
		? undefined
		: { ...parsed, label: parsed.label ?? parsed.kind };
};

const chainReport = object<ChainReport>({
	callId: required(nonEmptyString),
	title: required(string),
	provider: required(string),
	hops: required(list(readHop)),
	breaks: required(list(readBreak)),
	limits: optional(limits),
	coverage: fallback(list(coverage), []),
});

/**
 * Narrow one opaque record payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the chain, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool keeps a text
 *   result as the source of truth for the model.
 */
export function asChainReport(value: unknown): ChainReport | undefined {
	// The list readers turn a malformed list into an empty one; a top-level
	// document with no arrays is not a chain at all.
	if (
		!isRecord(value) ||
		!Array.isArray(value.hops) ||
		!Array.isArray(value.breaks)
	)
		return undefined;

	return chainReport(value);
}

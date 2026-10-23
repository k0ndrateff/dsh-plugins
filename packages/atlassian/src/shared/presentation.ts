/**
 * The card the agent can put in front of the user.
 *
 * The host half publishes one of these as a tool result's `presentationMeta`;
 * the browser half narrows it out of the persisted result and renders it as a
 * card under the closing text of the turn. The payload is opaque JSON on the
 * wire, so both halves share this type and the browser half validates it before
 * rendering.
 */

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
	trueOnly,
} from "dsh-integration-host/shape";

import type { IssueCard, PageCard } from "./meta";

/** How much room one card gives each item. */
export type PresentationLayout = "single" | "compact" | "list";

/** What the tool accepts; `auto` is resolved by the host before recording. */
export type PresentationLayoutInput = PresentationLayout | "auto";

/** One thing on the card. */
export type PresentationItem =
	| { readonly kind: "issue"; readonly issue: IssueCard }
	| { readonly kind: "page"; readonly page: PageCard };

/** One recorded presentation, as the browser half reads it. */
export interface AtlassianPresentation {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	/** Optional heading, such as "План на день". */
	readonly title?: string;
	readonly layout: PresentationLayout;
	/**
	 * How many items the search matched, when that is more than the card shows.
	 *
	 * A card that scrolls says "25 of 137 issues"; a card that shows everything
	 * leaves this out rather than repeating the item count.
	 */
	readonly total?: number;
	/** Whether the server held back another page of search results. */
	readonly truncated?: boolean;
	/** Issues and pages, in the order the tool put them. */
	readonly items: readonly PresentationItem[];
}

/** A card is trusted once its identity field is there; the host built the rest. */
const issueCard: Reader<IssueCard> = (value) =>
	isRecord(value) && typeof value.key === "string"
		? (value as unknown as IssueCard)
		: undefined;

/** A page card is trusted once its title is there. */
const pageCard: Reader<PageCard> = (value) =>
	isRecord(value) && typeof value.title === "string"
		? (value as unknown as PageCard)
		: undefined;

const item = oneOf<PresentationItem>(
	object<Extract<PresentationItem, { kind: "issue" }>>({
		kind: required(literal("issue")),
		issue: required(issueCard),
	}),
	object<Extract<PresentationItem, { kind: "page" }>>({
		kind: required(literal("page")),
		page: required(pageCard),
	}),
);

const layout = oneOf<PresentationLayout>(
	literal("single"),
	literal("compact"),
	literal("list"),
);

const presentation = object<AtlassianPresentation>({
	callId: required(nonEmptyString),
	title: optional(nonEmptyString),
	layout: fallback(layout, "list"),
	total: optional(number),
	truncated: optional(trueOnly),
	items: required(list(item)),
});

/**
 * Validate one opaque record payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the presentation, or undefined when the record is not one of ours or
 *   was written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool keeps a text
 *   result as the source of truth for the model.
 */
export function asPresentation(
	value: unknown,
): AtlassianPresentation | undefined {
	const parsed = presentation(value);

	if (parsed === undefined || parsed.items.length === 0) return undefined;

	const { total, ...rest } = parsed;

	return total !== undefined && total > parsed.items.length
		? { ...rest, total }
		: rest;
}

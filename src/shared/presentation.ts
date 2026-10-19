/**
 * The card the agent can put in front of the user.
 *
 * The host half publishes one of these as a tool result's `presentationMeta`;
 * the browser half narrows it out of the persisted result and renders it as a
 * card under the closing text of the turn. The payload is opaque JSON on the
 * wire, so both halves share this type and the browser half validates it before
 * rendering.
 */

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
	/** Issues and pages, in the order the tool put them. */
	readonly items: readonly PresentationItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asItem(value: unknown): PresentationItem | undefined {
	if (!isRecord(value)) return undefined;

	if (
		value.kind === "issue" &&
		isRecord(value.issue) &&
		typeof value.issue.key === "string"
	)
		return { kind: "issue", issue: value.issue as unknown as IssueCard };

	if (
		value.kind === "page" &&
		isRecord(value.page) &&
		typeof value.page.title === "string"
	)
		return { kind: "page", page: value.page as unknown as PageCard };

	return undefined;
}

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
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (!Array.isArray(value.items)) return undefined;

	const layout: PresentationLayout =
		value.layout === "single" ||
		value.layout === "compact" ||
		value.layout === "list"
			? value.layout
			: "list";

	const items: PresentationItem[] = [];
	for (const candidate of value.items) {
		const item = asItem(candidate);
		if (item !== undefined) items.push(item);
	}

	if (items.length === 0) return undefined;

	return {
		callId: value.callId,
		...(typeof value.title === "string" && value.title !== ""
			? { title: value.title }
			: {}),
		layout,
		items,
	};
}

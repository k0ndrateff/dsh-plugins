/**
 * What one integration's result card says about itself.
 *
 * The payload is the plugin's own — a Sentry issue list, a Jira search, a run of
 * project checks — and this is how the shared tail reads it without knowing any
 * of those words: the heading, the count, how much room each item gets, and what
 * sits around the list.
 */

import type { ReactNode } from "react";

/** How much room one card gives each item. */
export type PresentationLayout = "single" | "compact" | "list";

/** What the tool accepts; `auto` is resolved by the host before recording. */
export type PresentationLayoutInput = PresentationLayout | "auto";

/**
 * How one integration's card draws itself.
 *
 * `TOwner` is what the turn-tail seat was handed — the closing turn, its
 * sequence, and whatever else the page gives that seat — for a card that needs
 * more than its own payload, such as an opener for the files a check named.
 */
export interface CardProvider<TCard, TOwner = unknown> {
	/** The card's identity; what keys it in the turn's list. */
	callId(card: TCard): string;
	/** The card's own heading, when the payload carries one. */
	title(card: TCard): string | undefined;
	/** The heading's right side, such as "3 issues". */
	count(card: TCard): string;
	/** How many items the list holds, for the scroll rule. */
	length(card: TCard): number;
	/** How much room the list gives each item. */
	layout(card: TCard): PresentationLayout;
	/** The list's contents. */
	items(card: TCard, owner: TOwner): ReactNode;
	/** What sits between the heading and the list, such as the query it ran. */
	meta?(card: TCard, owner: TOwner): ReactNode;
	/** What sits under the list. */
	footer?(card: TCard, owner: TOwner): ReactNode;
}

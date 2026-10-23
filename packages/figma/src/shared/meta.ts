/**
 * What a Figma card shows, on both sides of the wire.
 *
 * The host half reads one node out of the Dev Mode MCP server's answers, records
 * it as a tool result's `presentationMeta`, and the browser half narrows it out
 * of the persisted result to draw the card under the agent's answer. The payload
 * is opaque JSON on the wire, so both halves share the types and the browser
 * half validates before rendering.
 */

import {
	literal,
	nonEmptyString,
	number,
	object,
	oneOf,
	optional,
	required,
} from "dsh-integration-host/shape";

/** How much room one card gives each item. */
export type PresentationLayout = "single" | "compact" | "list";

/** What the tool accepts; `auto` is resolved by the host before recording. */
export type PresentationLayoutInput = PresentationLayout | "auto";

/** One node, as a card row shows it. */
export interface FigmaNodeCard {
	/** The node's own id, as Figma spells it: `960:6938`. */
	readonly id: string;
	readonly name: string;
	/** The layer type in lower case: `frame`, `symbol`, `text`. */
	readonly type: string;
	readonly width: number;
	readonly height: number;
	/** How many variables the node uses. */
	readonly tokenCount: number;
	/** How many direct children it has. */
	readonly childCount: number;
	/** The component it maps to through Code Connect, when one does. */
	readonly component?: string;
	/** Where that component lives: a repository path or a URL. */
	readonly source?: string;
}

/** One recorded card, as the browser half reads it. */
export interface FigmaPresentation {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	readonly layout: PresentationLayout;
	readonly node: FigmaNodeCard;
}

/** The layout words this version can draw. */
const layout = oneOf<PresentationLayout>(
	literal("single"),
	literal("compact"),
	literal("list"),
);

/** One node as the card draws it. */
const nodeCard = object<FigmaNodeCard>({
	id: required(nonEmptyString),
	name: required(nonEmptyString),
	type: required(nonEmptyString),
	width: required(number),
	height: required(number),
	tokenCount: required(number),
	childCount: required(number),
	component: optional(nonEmptyString),
	source: optional(nonEmptyString),
});

/**
 * Narrow one card out of a tool result's persisted metadata.
 * @param value - the opaque `presentationMeta` of a settled call.
 * @returns the card, or undefined when this version cannot draw it.
 */
export const asFigmaPresentation = object<FigmaPresentation>({
	callId: required(nonEmptyString),
	layout: required(layout),
	node: required(nodeCard),
});

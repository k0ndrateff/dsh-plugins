/**
 * What a Figma panel shows, on both sides of the wire.
 *
 * The host half reads these rows out of the Dev Mode MCP server's answers and
 * serves them from `/dsh-figma/node`; the browser half narrows them before it
 * draws anything, because the document crosses the wire as opaque JSON. The
 * screenshot is the one thing that cannot travel inside the document — it is a
 * URL the page fetches from the same route.
 */

import {
	isRecord,
	isTrue,
	list,
	literal,
	nonEmptyString,
	number,
	object,
	optional,
	type Reader,
	required,
} from "dsh-integration-host/shape";

/** Which of the panel's three sections it opens on. */
export type PanelSection = "frame" | "tokens" | "code";

/** What one Figma panel was opened on. */
export interface PanelTarget {
	/** The node to show: an id like `1:2`, or a Figma URL naming one. */
	readonly node?: string;
	/** Which section to show first; the frame unless a card says otherwise. */
	readonly section?: PanelSection;
}

/** One node of the document, as the metadata describes it. */
export interface FigmaNode {
	/** The node's own id, as Figma spells it: `960:6938`. */
	readonly id: string;
	readonly name: string;
	/** The layer type in lower case: `frame`, `symbol`, `text`, `canvas`. */
	readonly type: string;
	readonly width: number;
	readonly height: number;
	/** Position within the parent, when the metadata carried one. */
	readonly x?: number;
	readonly y?: number;
}

/** One variable the node uses — a design token, in Figma's words. */
export interface FigmaToken {
	/** The variable's name, such as `text/primary`. */
	readonly name: string;
	/** Its value as the server rendered it: a colour, a number, a font. */
	readonly value: string;
}

/** One Code Connect mapping: a node, and the component in the codebase it is. */
export interface FigmaMapping {
	readonly nodeId: string;
	/** The component's name in the codebase, such as `MenuItems`. */
	readonly component: string;
	/** Where that component lives: a repository path or a URL. */
	readonly source: string;
}

/** Everything the panel shows for one node. */
export interface NodePanel {
	readonly kind: "node";
	/** The node itself. */
	readonly node: FigmaNode;
	/** The route the page fetches the frame's picture from, or null for none. */
	readonly screenshot: string | null;
	/** The variables the node uses. */
	readonly tokens: readonly FigmaToken[];
	/** Why the variables read failed, when it did; absence means "read". */
	readonly tokensError?: string;
	/** Whether the node used more variables than the panel lists. */
	readonly tokensTruncated: boolean;
	/** How many variables the node uses in total. */
	readonly tokenTotal: number;
	/** The Code Connect mappings that name this node. */
	readonly mappings: readonly FigmaMapping[];
	/** Why the Code Connect read failed, when it did; absence means "read". */
	readonly mappingsError?: string;
	/** The node's direct children, for reading its structure. */
	readonly children: readonly FigmaNode[];
	/** Whether the node has more children than the panel lists. */
	readonly childrenTruncated: boolean;
	/** How many direct children the node has. */
	readonly childTotal: number;
}

/** The three sections this version can draw. */
const section: Reader<PanelSection> = (value) =>
	value === "frame" || value === "tokens" || value === "code"
		? value
		: undefined;

/** One node, as the metadata describes it. */
const node = object<FigmaNode>({
	id: required(nonEmptyString),
	name: required(nonEmptyString),
	type: required(nonEmptyString),
	width: required(number),
	height: required(number),
	x: optional(number),
	y: optional(number),
});

/** One variable the node uses. */
const token = object<FigmaToken>({
	name: required(nonEmptyString),
	value: required(nonEmptyString),
});

/** One Code Connect mapping. */
const mapping = object<FigmaMapping>({
	nodeId: required(nonEmptyString),
	component: required(nonEmptyString),
	source: required(nonEmptyString),
});

/** The screenshot is always a value: null when there is no picture. */
const screenshot: Reader<string | null> = (value) =>
	nonEmptyString(value) ?? null;

/** The panel document before its two counts are filled from the lists. */
type NodePanelWire = Omit<NodePanel, "tokenTotal" | "childTotal"> & {
	readonly tokenTotal?: number;
	readonly childTotal?: number;
};

const nodePanel = object<NodePanelWire>({
	kind: required(literal("node")),
	node: required(node),
	screenshot: required(screenshot),
	tokens: required(list(token)),
	tokensError: optional(nonEmptyString),
	tokensTruncated: required(isTrue),
	tokenTotal: optional(number),
	mappings: required(list(mapping)),
	mappingsError: optional(nonEmptyString),
	children: required(list(node)),
	childrenTruncated: required(isTrue),
	childTotal: optional(number),
});

/**
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without one.
 */
export function asPanelTarget(value: unknown): PanelTarget | undefined {
	if (!isRecord(value)) return undefined;
	if (value.section !== undefined && section(value.section) === undefined)
		return undefined;

	return target(value);
}

const target = object<PanelTarget>({
	node: optional(nonEmptyString),
	section: optional(section),
});

/**
 * Narrow the document the host answered with.
 * @param value - the route's answer, before validation.
 * @returns the document, or undefined when this version cannot draw it.
 */
export function asNodePanel(value: unknown): NodePanel | undefined {
	const parsed = nodePanel(value);

	if (parsed === undefined) return undefined;

	return {
		...parsed,
		tokenTotal: parsed.tokenTotal ?? parsed.tokens.length,
		childTotal: parsed.childTotal ?? parsed.children.length,
	};
}

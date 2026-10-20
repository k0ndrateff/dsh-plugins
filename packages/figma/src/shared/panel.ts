/**
 * What a Figma panel shows, on both sides of the wire.
 *
 * The host half reads these rows out of the Dev Mode MCP server's answers and
 * serves them from `/dsh-figma/node`; the browser half narrows them before it
 * draws anything, because the document crosses the wire as opaque JSON. The
 * screenshot is the one thing that cannot travel inside the document — it is a
 * URL the page fetches from the same route.
 */

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
	/** Whether the node used more variables than the panel lists. */
	readonly tokensTruncated: boolean;
	/** The Code Connect mappings that name this node. */
	readonly mappings: readonly FigmaMapping[];
	/** The node's direct children, for reading its structure. */
	readonly children: readonly FigmaNode[];
	/** Whether the node has more children than the panel lists. */
	readonly childrenTruncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asNode(value: unknown): FigmaNode | undefined {
	if (!isRecord(value)) return undefined;

	const id = asString(value.id);
	const name = asString(value.name);
	const type = asString(value.type);
	const width = asNumber(value.width);
	const height = asNumber(value.height);

	if (
		id === undefined ||
		name === undefined ||
		type === undefined ||
		width === undefined ||
		height === undefined
	)
		return undefined;

	const x = asNumber(value.x);
	const y = asNumber(value.y);

	return {
		id,
		name,
		type,
		width,
		height,
		...(x === undefined ? {} : { x }),
		...(y === undefined ? {} : { y }),
	};
}

function asNodes(value: unknown): FigmaNode[] {
	if (!Array.isArray(value)) return [];

	const nodes: FigmaNode[] = [];
	for (const candidate of value) {
		const node = asNode(candidate);
		if (node !== undefined) nodes.push(node);
	}

	return nodes;
}

function asTokens(value: unknown): FigmaToken[] {
	if (!Array.isArray(value)) return [];

	const tokens: FigmaToken[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) continue;

		const name = asString(candidate.name);
		const tokenValue = asString(candidate.value);

		if (name !== undefined && tokenValue !== undefined)
			tokens.push({ name, value: tokenValue });
	}

	return tokens;
}

function asMappings(value: unknown): FigmaMapping[] {
	if (!Array.isArray(value)) return [];

	const mappings: FigmaMapping[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) continue;

		const nodeId = asString(candidate.nodeId);
		const component = asString(candidate.component);
		const source = asString(candidate.source);

		if (nodeId !== undefined && component !== undefined && source !== undefined)
			mappings.push({ nodeId, component, source });
	}

	return mappings;
}

/**
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without one.
 */
export function asPanelTarget(value: unknown): PanelTarget | undefined {
	if (!isRecord(value)) return undefined;

	const node = asString(value.node);
	const section = value.section;

	if (
		section !== undefined &&
		section !== "frame" &&
		section !== "tokens" &&
		section !== "code"
	)
		return undefined;

	return {
		...(node === undefined ? {} : { node }),
		...(section === undefined ? {} : { section }),
	};
}

/**
 * Narrow the document the host answered with.
 * @param value - the route's answer, before validation.
 * @returns the document, or undefined when this version cannot draw it.
 */
export function asNodePanel(value: unknown): NodePanel | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind !== "node") return undefined;

	const node = asNode(value.node);
	if (node === undefined) return undefined;

	const screenshot = asString(value.screenshot);

	return {
		kind: "node",
		node,
		screenshot: screenshot ?? null,
		tokens: asTokens(value.tokens),
		tokensTruncated: value.tokensTruncated === true,
		mappings: asMappings(value.mappings),
		children: asNodes(value.children),
		childrenTruncated: value.childrenTruncated === true,
	};
}

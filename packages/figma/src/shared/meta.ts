/**
 * What a Figma card shows, on both sides of the wire.
 *
 * The host half reads one node out of the Dev Mode MCP server's answers, records
 * it as a tool result's `presentationMeta`, and the browser half narrows it out
 * of the persisted result to draw the card under the agent's answer. The payload
 * is opaque JSON on the wire, so both halves share the types and the browser
 * half validates before rendering.
 */

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

function asNodeCard(value: unknown): FigmaNodeCard | undefined {
	if (!isRecord(value)) return undefined;

	const id = asString(value.id);
	const name = asString(value.name);
	const type = asString(value.type);
	const width = asNumber(value.width);
	const height = asNumber(value.height);
	const tokenCount = asNumber(value.tokenCount);
	const childCount = asNumber(value.childCount);

	if (
		id === undefined ||
		name === undefined ||
		type === undefined ||
		width === undefined ||
		height === undefined ||
		tokenCount === undefined ||
		childCount === undefined
	)
		return undefined;

	const component = asString(value.component);
	const source = asString(value.source);

	return {
		id,
		name,
		type,
		width,
		height,
		tokenCount,
		childCount,
		...(component === undefined ? {} : { component }),
		...(source === undefined ? {} : { source }),
	};
}

/**
 * Narrow one card out of a tool result's persisted metadata.
 * @param value - the opaque `presentationMeta` of a settled call.
 * @returns the card, or undefined when this version cannot draw it.
 */
export function asFigmaPresentation(
	value: unknown,
): FigmaPresentation | undefined {
	if (!isRecord(value)) return undefined;

	const callId = asString(value.callId);
	const node = asNodeCard(value.node);
	const layout = value.layout;

	if (callId === undefined || node === undefined) return undefined;
	if (layout !== "single" && layout !== "compact" && layout !== "list")
		return undefined;

	return { callId, layout, node };
}

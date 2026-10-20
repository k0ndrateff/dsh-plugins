/**
 * Reading what the Figma Dev Mode server answers.
 *
 * Every read here is a pure function of one MCP result, because the shapes are
 * the server's own and none of them is documented as a schema: `get_metadata`
 * answers XML, `get_variable_defs` and `get_code_connect_map` answer a JSON
 * object keyed by name, and `get_screenshot` answers an image block. Keeping the
 * reading separate from the bridge is what makes these testable against captures
 * taken from a live server.
 */

import { asRecord, mcpJson, mcpText } from "dsh-mcp-oauth";
import type { FigmaMapping, FigmaNode, FigmaToken } from "../../shared/panel";

/** The result of reading one node's metadata. */
export interface Metadata {
	/** The element the XML root names: the node that was asked about. */
	readonly root: FigmaNode;
	/** Its direct children, in document order. */
	readonly children: readonly FigmaNode[];
	/** How many layers the subtree holds, the root included. */
	readonly layers: number;
}

/** A node id as Figma spells it in a URL, and as the tools accept it. */
const NODE_ID = /^\d+[:-]\d+$/u;

/** One element of the metadata XML, as the reader walks it. */
interface Element {
	readonly name: string;
	readonly attributes: Record<string, string>;
}

/** Matches one tag; attributes are quoted, so `>` never appears inside one. */
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/gu;

/** Matches one `name="value"` pair inside a tag. */
const ATTRIBUTE = /([A-Za-z][A-Za-z0-9_:-]*)\s*=\s*"([^"]*)"/gu;

/** The five entities an XML attribute may carry. */
const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
};

const decode = (value: string): string =>
	value.replace(
		/&(?:amp|lt|gt|quot|apos);/gu,
		(entity) => ENTITIES[entity] ?? entity,
	);

/** One attribute's number, or undefined when it is absent or not a number. */
const numberOf = (
	attributes: Record<string, string>,
	name: string,
): number | undefined => {
	const raw = attributes[name];
	if (raw === undefined) return undefined;

	const value = Number(raw);

	return Number.isFinite(value) ? value : undefined;
};

/** One element as a node; undefined when it names neither an id nor a layer. */
const nodeOf = (element: Element): FigmaNode | undefined => {
	const { attributes } = element;
	const id = attributes.id;
	const name = attributes.name;

	if (id === undefined || name === undefined) return undefined;

	const x = numberOf(attributes, "x");
	const y = numberOf(attributes, "y");

	return {
		id,
		name,
		type: element.name.toLowerCase(),
		width: numberOf(attributes, "width") ?? 0,
		height: numberOf(attributes, "height") ?? 0,
		...(x === undefined ? {} : { x }),
		...(y === undefined ? {} : { y }),
	};
};

/**
 * Read one node's subtree out of `get_metadata`'s XML.
 *
 * The answer carries the requested element and everything under it, so only the
 * root and its direct children are kept: a page's answer is a whole document,
 * and the panel shows one level at a time. Everything after the root's closing
 * tag is the server's own advice to the agent and is not part of the document.
 * @param value - the MCP result, as the tool answered it.
 * @returns the node and its children, or undefined when the server answered with
 *   prose instead of XML — which is what it does when nothing is selected.
 */
export function parseMetadata(value: unknown): Metadata | undefined {
	const text = mcpText(value).join("\n").trim();

	if (!text.startsWith("<")) return undefined;

	let root: FigmaNode | undefined;
	const children: FigmaNode[] = [];
	const stack: (FigmaNode | undefined)[] = [];
	let layers = 0;
	let closed = false;

	for (const match of text.matchAll(TAG)) {
		if (closed) break;

		const closing = match[1] === "/";
		const attributes: Record<string, string> = {};

		for (const pair of (match[3] ?? "").matchAll(ATTRIBUTE))
			attributes[pair[1] ?? ""] = decode(pair[2] ?? "");

		if (closing) {
			stack.pop();
			if (stack.length === 0) closed = true;

			continue;
		}

		const node = nodeOf({ name: match[2] ?? "", attributes });
		if (node !== undefined) layers += 1;

		if (match[4] === "/") {
			if (stack.length === 0) root = node;
			else if (stack.length === 1 && node !== undefined) children.push(node);

			continue;
		}

		if (stack.length === 0) root = node;
		else if (stack.length === 1 && node !== undefined) children.push(node);

		stack.push(node);
	}

	return root === undefined ? undefined : { root, children, layers };
}

/** One value as the token list spells it: numbers and booleans as text. */
const tokenValue = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (value === null || value === undefined) return undefined;

	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
};

/**
 * Read the variables one node uses out of `get_variable_defs`.
 *
 * The server answers a flat object of `name: value`, where the value is how it
 * renders that variable — a colour, a spacing number, a whole font shorthand.
 * @param value - the MCP result, as the tool answered it.
 */
export function parseVariableDefs(value: unknown): FigmaToken[] {
	const tokens: FigmaToken[] = [];

	for (const root of mcpJson(value)) {
		const record = asRecord(root);
		if (record === undefined) continue;

		for (const [name, raw] of Object.entries(record)) {
			const rendered = tokenValue(raw);

			if (rendered !== undefined) tokens.push({ name, value: rendered });
		}
	}

	return tokens;
}

/** One Code Connect entry, as the server spells it. */
const mappingOf = (
	value: unknown,
	nodeId: string,
): FigmaMapping | undefined => {
	const record = asRecord(value);
	if (record === undefined) return undefined;

	const component = record.codeConnectName;
	const source = record.codeConnectSrc;

	if (typeof component !== "string" || component === "") return undefined;
	if (typeof source !== "string" || source === "") return undefined;

	return { nodeId, component, source };
};

/**
 * Read Code Connect mappings out of `get_code_connect_map`.
 *
 * The documented answer is an object keyed by node id, and an unmapped node
 * answers `{}`; the reader also accepts the single mapping itself, which the
 * server uses when the question named exactly one node.
 * @param value - the MCP result, as the tool answered it.
 * @param nodeId - the node the question was about, for the single-mapping shape.
 */
export function parseCodeConnectMap(
	value: unknown,
	nodeId: string,
): FigmaMapping[] {
	const mappings: FigmaMapping[] = [];

	for (const root of mcpJson(value)) {
		const record = asRecord(root);
		if (record === undefined) continue;

		const direct = mappingOf(record, nodeId);
		if (direct !== undefined) {
			mappings.push(direct);
			continue;
		}

		for (const [id, entry] of Object.entries(record)) {
			const mapping = mappingOf(entry, id);

			if (mapping !== undefined) mappings.push(mapping);
		}
	}

	return mappings;
}

/** One image the server answered with, decoded. */
export interface Screenshot {
	readonly contentType: string;
	readonly bytes: Uint8Array;
}

/**
 * Read the image out of `get_screenshot`'s answer.
 * @param value - the MCP result, as the tool answered it.
 * @returns the decoded bytes, or undefined when the answer carried no image.
 */
export function parseScreenshot(value: unknown): Screenshot | undefined {
	const record = asRecord(value);
	const content = record?.content;

	if (!Array.isArray(content)) return undefined;

	for (const block of content) {
		const entry = asRecord(block);

		if (entry?.type !== "image" || typeof entry.data !== "string") continue;

		const contentType =
			typeof entry.mimeType === "string" && entry.mimeType !== ""
				? entry.mimeType
				: "image/png";

		return { contentType, bytes: Buffer.from(entry.data, "base64") };
	}

	return undefined;
}

/**
 * Read the node a target names, whichever way it spells it.
 *
 * A node is named by an id — `1:2`, or the `1-2` a URL uses — or by the link
 * Figma's own "Copy link to selection" puts on the clipboard, which carries the
 * id in `node-id` and the file in its path.
 * @param value - the text the caller passed, trimmed by this reader.
 * @returns the node id in Figma's own spelling, and the file when the text was a
 *   URL, or undefined when the text names no node.
 */
export function parseNodeRef(
	value: string,
): { nodeId: string; fileKey?: string } | undefined {
	const text = value.trim();
	if (text === "") return undefined;

	if (NODE_ID.test(text)) return { nodeId: text.replace("-", ":") };

	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}

	const nodeId = url.searchParams.get("node-id");
	if (nodeId === null || !NODE_ID.test(nodeId)) return undefined;

	// A branch URL carries the branch key where a file URL carries the file key,
	// and the MCP server wants the branch's own key.
	const segments = url.pathname.split("/").filter((part) => part !== "");
	const branch = segments.indexOf("branch");
	const fileKey =
		branch === -1 ? segments[1] : (segments[branch + 1] ?? segments[1]);

	return {
		nodeId: nodeId.replace("-", ":"),
		...(fileKey === undefined || fileKey === "" ? {} : { fileKey }),
	};
}

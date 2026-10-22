/**
 * The side panel's view of one Figma node.
 *
 * The panel opens on a node and shows three things about it: what it is, which
 * variables it uses, and what it maps to in the codebase. All three are reads of
 * the same Dev Mode MCP server the agent's own tools reach, so the panel has no
 * second path to Figma — and the picture is a fourth read, asked for by the page
 * itself when the `<img>` it was handed resolves.
 */

import type { Context } from "@deepseek-ai/cordis";
import { errorText, loggerOf, type McpBridge } from "dsh-mcp-oauth";
import type { NodePanel, PanelTarget } from "../../shared/panel";
import {
	type Metadata,
	parseCodeConnectMap,
	parseMetadata,
	parseNodeRef,
	parseScreenshot,
	parseVariableDefs,
	type Screenshot,
} from "../presentation/parse";

/** How many of a node's children the panel lists. */
const MAX_CHILDREN = 40;

/** How many of a node's variables the panel lists. */
const MAX_TOKENS = 60;

/** What the panel says when nothing is selected in Figma. */
const NOTHING_SELECTED =
	"Nothing is selected in Figma. Select a frame in the desktop app, or name a node id like 1:2.";

/** What the panel needs from the plugin. */
export interface PanelDeps {
	readonly bridge: McpBridge;
	readonly ctx: Context;
}

/** The three reads that make one node's panel document. */
export class PanelApi {
	constructor(private readonly deps: PanelDeps) {}

	/**
	 * Load one node with the three facets the panel opens on.
	 * @param target - the node to show, or nothing for the current selection.
	 * @throws when Figma names no such node, or names none at all.
	 */
	async node(target: PanelTarget): Promise<NodePanel> {
		const metadata = await this.readMetadata(target);
		const nodeId = metadata.root.id;

		const tokens = parseVariableDefs(
			await this.optional("get_variable_defs", { nodeId }),
		);
		const mappings = parseCodeConnectMap(
			await this.optional("get_code_connect_map", { nodeId }),
			nodeId,
		);

		return {
			kind: "node",
			node: metadata.root,
			screenshot: this.screenshotUrl(nodeId),
			tokens: tokens.slice(0, MAX_TOKENS),
			tokensTruncated: tokens.length > MAX_TOKENS,
			tokenTotal: tokens.length,
			mappings,
			children: metadata.children.slice(0, MAX_CHILDREN),
			childrenTruncated: metadata.children.length > MAX_CHILDREN,
			childTotal: metadata.children.length,
		};
	}

	/**
	 * Read one node's picture.
	 * @param node - the node id, as Figma spells it.
	 * @throws when the server answers with no image for that node.
	 */
	async screenshot(node: string): Promise<Screenshot> {
		const shot = parseScreenshot(
			await this.deps.bridge.callTool("get_screenshot", { nodeId: node }),
		);

		if (shot === undefined)
			throw new Error(`Figma returned no picture for node ${node}`);

		return shot;
	}

	/**
	 * The route the page draws one node's picture from.
	 *
	 * The revision is what makes the picture current: the panel reloads its
	 * document on every open and every retry, and a URL that changed with it is
	 * what keeps the browser from reusing the frame it drew before.
	 */
	private screenshotUrl(nodeId: string): string {
		const revision = Date.now();

		return `/dsh-figma/screenshot?node=${encodeURIComponent(nodeId)}&rev=${revision}`;
	}

	/**
	 * Read the metadata of the target, or of the current selection.
	 *
	 * A selection is resolved by the same call: with no node id the server reads
	 * whatever is selected in the desktop app, and answers with prose instead of
	 * XML when nothing is.
	 */
	private async readMetadata(target: PanelTarget): Promise<Metadata> {
		if (target.node === undefined) {
			const selected = parseMetadata(await this.call("get_metadata", {}));

			if (selected === undefined) throw new Error(NOTHING_SELECTED);

			return selected;
		}

		const ref = parseNodeRef(target.node);

		if (ref === undefined)
			throw new Error(`"${target.node}" names no Figma node`);

		const metadata = parseMetadata(
			await this.call("get_metadata", { nodeId: ref.nodeId }),
		);

		if (metadata === undefined)
			throw new Error(`Figma returned no metadata for node ${ref.nodeId}`);

		return metadata;
	}

	/** One read whose failure is the panel's to report. */
	private async call(
		name: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		return await this.deps.bridge.callTool(name, args);
	}

	/**
	 * One read the panel can do without.
	 *
	 * A node with no variables, and a file with no Code Connect library, are both
	 * ordinary: the tools answer an empty object for the first and refuse with a
	 * message for the second, and neither is a reason to fail the panel.
	 */
	private async optional(
		name: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		try {
			return await this.call(name, args);
		} catch (error) {
			loggerOf(this.deps.ctx).warn(
				"[figma] %s answered nothing: %s",
				name,
				errorText(error),
			);

			return undefined;
		}
	}
}

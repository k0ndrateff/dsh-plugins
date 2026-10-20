/**
 * `figma_present` — the tool behind a card in the conversation and a panel on
 * the right.
 *
 * It resolves one node — by id, by a Figma link, or as whatever is selected in
 * the desktop app — reads what the Dev Mode server knows about it, and answers
 * the model with the facts as text. The picture is deliberately not part of that
 * answer: a screenshot costs a model far more context than the numbers beside
 * it, and the person looking at the panel can see it anyway. The model asks for
 * the image itself, through the server's own screenshot tool, when it needs one.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { JsonValue } from "dsh-mcp-oauth";
import type { FigmaNodeCard, FigmaPresentation } from "../../shared/meta";
import type { FigmaMapping, NodePanel, PanelTarget } from "../../shared/panel";
import type { PanelApi } from "../panels/panel";

/** How many variables and children the model's own summary lists. */
const MAX_LINES = 20;

/** What the tool needs from the plugin. */
export interface PresentDeps {
	readonly panel: PanelApi;
	/** The published name of the server's screenshot tool, for the model's own use. */
	readonly imageTool: string;
}

/** The arguments the model may send, after validation. */
interface PresentArgs {
	readonly node: string | undefined;
}

class PresentTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = "figma_present";

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the panel's own read, and the name of the image tool.
	 */
	create = (deps: PresentDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Show one Figma frame or layer to the user: its picture, its variables, and the " +
			"component it maps to through Code Connect, in the harness's side panel. Use this " +
			"whenever the user points at a Figma link, node id, or their current selection — " +
			"especially to compare a design against the implementation. Name the node with `node` " +
			"as a link from Figma or an id like `1:2`; omit it to use whatever is selected in the " +
			"Figma desktop app. The answer is the node's facts as text, and the panel is what the " +
			"user sees; to look at the design yourself, call the server's own screenshot tool " +
			"instead. Call it once per node, then write your answer.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				node: {
					type: "string",
					description:
						"The node to show: a Figma link (from “Copy link to selection”), an id like " +
						"`1:2`, or the `1-2` form a URL uses. Omit to use the current selection in " +
						"the Figma desktop app.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					nodeId: { type: "string" },
					summary: { type: "string" },
					presentation: { type: "object", additionalProperties: true },
				},
				required: ["nodeId", "summary", "presentation"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
			// The browser half reads this back as `result.meta` and renders the card.
			// It never reaches the model: the text above is what the model reads.
			presentationMeta: (_args, value) =>
				(value as { presentation: JsonValue }).presentation,
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const panel = await deps.panel.node(this.targetOf(args));
			const presentation = this.presentationOf(String(exec.callId), panel);

			return {
				nodeId: panel.node.id,
				summary: this.describe(panel, deps.imageTool),
				presentation,
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): PresentArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const node = args.node;

		return {
			node:
				typeof node === "string" && node.trim() !== ""
					? node.trim()
					: undefined,
		};
	}

	/** What the panel should be opened on. */
	private targetOf(args: PresentArgs): PanelTarget {
		return args.node === undefined ? {} : { node: args.node };
	}

	/** One node as the card shows it. */
	private presentationOf(callId: string, panel: NodePanel): FigmaPresentation {
		const mapping: FigmaMapping | undefined = panel.mappings[0];

		const node: FigmaNodeCard = {
			id: panel.node.id,
			name: panel.node.name,
			type: panel.node.type,
			width: panel.node.width,
			height: panel.node.height,
			tokenCount: panel.tokens.length,
			childCount: panel.children.length,
			...(mapping === undefined
				? {}
				: { component: mapping.component, source: mapping.source }),
		};

		return { callId, layout: "single", node };
	}

	/** The text the model reads: what the panel shows, in order. */
	private describe(panel: NodePanel, imageTool: string): string {
		const node = panel.node;
		const lines = [
			`${node.type} "${node.name}" (${node.id}), ${node.width}×${node.height}` +
				(panel.children.length === 0
					? ""
					: `, ${panel.children.length} child layer${panel.children.length === 1 ? "" : "s"}`),
		];

		lines.push(
			panel.tokens.length === 0
				? "Variables: none"
				: `Variables (${panel.tokens.length}): ${this.list(
						panel.tokens.map((token) => `${token.name} = ${token.value}`),
					)}`,
		);

		lines.push(
			panel.mappings.length === 0
				? "Code Connect: no mapping for this node"
				: `Code Connect: ${panel.mappings
						.map((mapping) => `${mapping.component} (${mapping.source})`)
						.join(", ")}`,
		);

		if (panel.children.length > 0)
			lines.push(
				`Children: ${this.list(
					panel.children.map(
						(child) =>
							`${child.name} (${child.type}, ${child.width}×${child.height})`,
					),
				)}`,
			);

		lines.push(
			`The user sees this ${node.type} and its variables in the Figma panel. ` +
				`To look at the design yourself, call ${imageTool}.`,
		);

		return lines.join("\n");
	}

	/** A bounded list, so one dense frame cannot fill the model's context. */
	private list(values: readonly string[]): string {
		const shown = values.slice(0, MAX_LINES);
		const rest = values.length - shown.length;

		return rest <= 0
			? shown.join(" · ")
			: `${shown.join(" · ")} · …and ${rest} more`;
	}
}

export const presentTool = new PresentTool();

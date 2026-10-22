/**
 * `browser_act` — do the thing, then say where the page ended up.
 *
 * Seven verbs rather than seven tools: they are the same act with a different
 * target, they share one validation, and a model that has learnt one call shape
 * has learnt all of them. What each verb means for a reference, a key, a
 * direction or a wait is on the parameter.
 *
 * After an action that can navigate, the address is read back, because "did my
 * click go anywhere" is the first question about a click and the CLI does not
 * answer it.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_ACT_TOOL } from "../../shared/tools";
import { fieldOf, isText, modelData } from "../envelope";
import { type BrowserToolDeps, runForSession } from "./deps";

/** The verbs this tool accepts. */
const ACTIONS = [
	"click",
	"fill",
	"press",
	"select",
	"hover",
	"scroll",
	"wait",
] as const;

type Action = (typeof ACTIONS)[number];

/** How each verb reads in the answer. */
const VERBS: Record<Action, string> = {
	click: "Clicked",
	fill: "Filled",
	press: "Pressed",
	select: "Selected",
	hover: "Hovered over",
	scroll: "Scrolled",
	wait: "Waited for",
};

/** The verbs after which the address is worth reading again. */
const NAVIGATES: readonly Action[] = ["click", "press", "select", "wait"];

/** The arguments the model may send, after validation. */
interface ActArgs {
	readonly action: Action;
	readonly target: string;
	readonly value: string | undefined;
}

class ActTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_ACT_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the caps.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Act on the page: click, fill, press, select, hover, scroll or wait. Address an " +
			"element with the `@eN` reference a snapshot gave you, or with a CSS selector. " +
			"References go stale as soon as the page changes, so take a fresh snapshot instead " +
			"of reusing one; after an action that navigates, the answer carries the new address.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["action", "target"],
			properties: {
				action: {
					type: "string",
					enum: [...ACTIONS],
					description: "What to do with the target.",
				},
				target: {
					type: "string",
					description:
						"What to act on: an `@eN` reference or a CSS selector for most verbs, the key " +
						"to press for `press`, a direction (`up`, `down`, `left`, `right`) for " +
						"`scroll`, and a selector or a number of milliseconds for `wait`.",
				},
				value: {
					type: "string",
					description:
						"The text to type for `fill` (required there), the option or options to pick " +
						"for `select` (required there, space-separated), and how many pixels to scroll " +
						"for `scroll` (optional).",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					action: { type: "string" },
					target: { type: "string" },
					url: { type: "string" },
				},
				required: ["action", "target", "url"],
			},
			render: (_args, value) => {
				const done = value as { action: Action; target: string; url: string };
				const lines = [`${VERBS[done.action]} \`${done.target}\`.`];

				if (done.url !== "") lines.push(`The page is at ${done.url}.`);

				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const outcome = await runForSession(deps, exec, this.argv(args));

			if (!outcome.ok) throw new Error(outcome.error);

			return {
				action: args.action,
				target: args.target,
				url: NAVIGATES.includes(args.action)
					? await this.urlAfter(deps, exec)
					: "",
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): ActArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const action = args.action;
		const target = args.target;

		if (typeof action !== "string" || !ACTIONS.includes(action as Action))
			throw new Error(
				`browser_act needs an action, one of: ${ACTIONS.join(", ")}`,
			);

		if (typeof target !== "string" || target.trim() === "")
			throw new Error(
				"browser_act needs a target: an `@eN` reference or a selector",
			);

		return {
			action: action as Action,
			target: target.trim(),
			value:
				typeof args.value === "string" && args.value !== ""
					? args.value
					: undefined,
		};
	}

	/** The CLI arguments one verb is run with. */
	private argv(args: ActArgs): string[] {
		switch (args.action) {
			case "click":
				return ["click", args.target];
			case "fill":
				return [
					"fill",
					args.target,
					this.requireValue(args, "the text to type"),
				];
			case "press":
				return ["press", args.target];
			case "select":
				return [
					"select",
					args.target,
					...this.requireValue(args, "the option to pick").split(/\s+/u),
				];
			case "hover":
				return ["hover", args.target];
			case "scroll":
				return [
					"scroll",
					args.target,
					...(args.value === undefined ? [] : [args.value]),
				];
			case "wait":
				return ["wait", args.target];
		}
	}

	/** The value one verb cannot work without. */
	private requireValue(args: ActArgs, what: string): string {
		if (args.value === undefined)
			throw new Error(
				`browser_act needs a value for \`${args.action}\`: ${what}`,
			);

		return args.value;
	}

	/** Where the page is now, or nothing when that could not be read. */
	private async urlAfter(
		deps: BrowserToolDeps,
		exec: Parameters<typeof runForSession>[1],
	): Promise<string> {
		const outcome = await runForSession(deps, exec, ["get", "url"]);

		return outcome.ok
			? (fieldOf(modelData(outcome.data), "url", isText) ?? "")
			: "";
	}
}

export const actTool = new ActTool();

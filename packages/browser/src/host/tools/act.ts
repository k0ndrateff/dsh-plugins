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
import { failureOf } from "./failure";

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
	/** The options of a multiple `select`, each one exactly as the page labels it. */
	readonly values: readonly string[] | undefined;
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
			"of reusing one; after an action that navigates, the answer carries the new address, " +
			"or says that it could not be read.",
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
						"The text to type for `fill` (required there), the one option to pick for " +
						"`select` (required there; spaces are part of the option's value or label), " +
						"and how many pixels to scroll for `scroll` (optional).",
				},
				values: {
					type: "array",
					items: { type: "string" },
					description:
						"For `select` only: several options to pick, each as one entry. Use it instead " +
						"of `value` when the page accepts more than one choice.",
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
					addressUnread: { type: "boolean" },
				},
				required: ["action", "target", "url", "addressUnread"],
			},
			render: (_args, value) => {
				const done = value as {
					action: Action;
					target: string;
					url: string;
					addressUnread: boolean;
				};
				const lines = [`${VERBS[done.action]} \`${done.target}\`.`];

				// "The page did not move" and "the address could not be read" look the
				// same when both are an empty string, and they mean opposite things.
				if (done.addressUnread)
					lines.push(
						"The page's address could not be read after this action, so whether it moved is unknown.",
					);
				else if (done.url !== "") lines.push(`The page is at ${done.url}.`);

				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const { outcome } = await runForSession(deps, exec, this.argv(args));

			if (!outcome.ok) throw failureOf(outcome);

			if (!NAVIGATES.includes(args.action))
				return {
					action: args.action,
					target: args.target,
					url: "",
					addressUnread: false,
				};

			const address = await this.addressAfter(deps, exec);

			return {
				action: args.action,
				target: args.target,
				url: address.url,
				addressUnread: address.unread,
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

		const values = Array.isArray(args.values)
			? args.values.filter(
					(entry): entry is string => typeof entry === "string" && entry !== "",
				)
			: undefined;

		return {
			action: action as Action,
			target: target.trim(),
			value:
				typeof args.value === "string" && args.value !== ""
					? args.value
					: undefined,
			values: values === undefined || values.length === 0 ? undefined : values,
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
					...(args.values ?? [this.requireValue(args, "the option to pick")]),
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

	/**
	 * Where the page is now, and whether the question could be answered at all.
	 *
	 * A failed `get url` is not "the page did not move": the address is unknown,
	 * and the answer has to say which of the two happened.
	 */
	private async addressAfter(
		deps: BrowserToolDeps,
		exec: Parameters<typeof runForSession>[1],
	): Promise<{ url: string; unread: boolean }> {
		const { outcome } = await runForSession(deps, exec, ["get", "url"]);

		if (!outcome.ok) return { url: "", unread: true };

		return {
			url: fieldOf(modelData(outcome.data), "url", isText) ?? "",
			unread: false,
		};
	}
}

export const actTool = new ActTool();

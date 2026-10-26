/**
 * `browser_snapshot` — the page as the agent's eyes.
 *
 * The accessibility tree is what the page *is*: buttons, headings, fields and
 * their names, in reading order, with one `@eN` reference per element to act on.
 * It is also the whole point of driving a real browser from a model's side: a
 * page of HTML costs thousands of tokens, and the tree of the same page costs
 * tens.
 *
 * References are minted by each snapshot and die with the next page change, so
 * the tool says how many it just handed out and the description says to come
 * back after anything that moves.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_SNAPSHOT_TOOL } from "../../shared/tools";
import { fieldOf, isRecord, isText, modelData } from "../envelope";
import { bound } from "../text";
import { type BrowserToolDeps, runForSession } from "./deps";
import { failureOf } from "./failure";

/** The arguments the model may send, after validation. */
interface SnapshotArgs {
	readonly interactive: boolean;
	readonly selector: string | undefined;
}

/** How many references a tree is read for, when the CLI reports none. */
const countedRefs = (tree: string): number =>
	tree.split("\n").filter((line) => line.includes("[ref=")).length;

class SnapshotTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_SNAPSHOT_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the caps.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Read the page's accessibility tree as text, with one `@eN` reference per element. " +
			"This is how to see what is on the page and what to act on: references come from " +
			"here, and they go stale as soon as the page changes, so snapshot again after " +
			"anything that navigates or re-renders.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				interactive: {
					type: "boolean",
					description:
						"List only the elements a person can act on. Defaults to true; set false for " +
						"the whole tree, which is much longer.",
				},
				selector: {
					type: "string",
					description:
						"CSS selector to read one part of the page instead of all of it.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					snapshot: { type: "string" },
					elements: { type: "number" },
					url: { type: "string" },
					interactive: { type: "boolean" },
					selector: { type: "string" },
				},
				required: ["snapshot", "elements", "url", "interactive", "selector"],
			},
			render: (_args, value) => {
				const tree = value as {
					snapshot: string;
					elements: number;
					url: string;
					interactive: boolean;
					selector: string;
				};
				const where = tree.url === "" ? "this page" : tree.url;
				const empty = tree.snapshot.trim() === "";
				const lines: string[] = [];

				if (empty) {
					lines.push(
						tree.selector === ""
							? tree.interactive
								? `Nothing to act on: ${where} has no interactive elements. Ask with interactive:false for the whole tree, or with a selector for one part of it.`
								: `The page at ${where} has no accessible elements to read.`
							: `Nothing matched \`${tree.selector}\` on ${where}.`,
					);
				} else {
					lines.push(tree.snapshot);
					lines.push(
						`\n${tree.elements} element${tree.elements === 1 ? "" : "s"} · ${where}`,
					);
				}

				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const { outcome } = await runForSession(deps, exec, this.argv(args));

			if (!outcome.ok) throw failureOf(outcome);

			const data = modelData(outcome.data);
			const tree = fieldOf(data, "snapshot", isText) ?? "";
			const refs = fieldOf(data, "refs", isRecord);

			return {
				snapshot: bound(tree, deps.config.maxOutputBytes),
				elements:
					refs === undefined ? countedRefs(tree) : Object.keys(refs).length,
				url: fieldOf(data, "origin", isText) ?? "",
				interactive: args.interactive,
				selector: args.selector ?? "",
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): SnapshotArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		return {
			interactive: args.interactive !== false,
			selector:
				typeof args.selector === "string" && args.selector.trim() !== ""
					? args.selector.trim()
					: undefined,
		};
	}

	/** The CLI arguments one snapshot is read with. */
	private argv(args: SnapshotArgs): string[] {
		return [
			"snapshot",
			...(args.interactive ? ["-i"] : []),
			...(args.selector === undefined ? [] : ["-s", args.selector]),
		];
	}
}

export const snapshotTool = new SnapshotTool();

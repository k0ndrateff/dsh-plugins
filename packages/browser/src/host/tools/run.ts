/**
 * `browser_run` — the long tail of the CLI, without a second vocabulary.
 *
 * The five dedicated tools cover the loop a UI change needs. Everything else a
 * real browser driver can do — tabs, network routing and request logs, cookies
 * and storage, a11y audits, traces, the React tree — stays reachable through one
 * escape hatch, so the model never has to fall back to `bash` for it and the
 * plugin never has to grow a tool per CLI verb.
 *
 * The command is run in this session's browser like every other call, and its
 * answer is cut the same way.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_RUN_TOOL } from "../../shared/tools";
import { modelData } from "../envelope";
import { bound, jsonText } from "../text";
import { type BrowserToolDeps, runForSession } from "./deps";

/** The arguments the model may send, after validation. */
interface RunArgs {
	readonly args: readonly string[];
}

class RunTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_RUN_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the caps.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Run any other agent-browser command in this conversation's browser and read its " +
			"JSON answer — tabs, network requests, cookies and storage, an accessibility audit, " +
			"tracing, the React tree. Use it for what the other browser tools do not cover; " +
			"`agent-browser --help` lists the commands.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["args"],
			properties: {
				args: {
					type: "array",
					items: { type: "string" },
					description:
						'The command and its arguments as separate entries, for example ["tab", ' +
						'"list"] or ["network", "requests"]. Do not include the executable or --json.',
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					command: { type: "string" },
					answer: { type: "string" },
				},
				required: ["command", "answer"],
			},
			render: (_args, value) => {
				const ran = value as { command: string; answer: string };

				return [
					{
						type: "text",
						text:
							ran.answer === ""
								? `agent-browser ${ran.command}\nThe command answered nothing.`
								: `agent-browser ${ran.command}\n${ran.answer}`,
					},
				];
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs, deps.config.executable);
			const { session, outcome } = await runForSession(deps, exec, args.args);

			if (!outcome.ok) throw new Error(outcome.error);

			// A browser the agent closed through the escape hatch is as closed as one
			// the panel closed: the hub stops looking for it either way.
			if (args.args[0] === "close") deps.hubs.markClosed(session.name);

			return {
				command: args.args.join(" "),
				answer: bound(
					jsonText(modelData(outcome.data)),
					deps.config.maxOutputBytes,
				),
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown, executable: string): RunArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const entries = Array.isArray(args.args) ? args.args : [];

		if (!entries.every((entry): entry is string => typeof entry === "string"))
			throw new Error("browser_run takes the command as an array of strings");

		// A model that writes the whole command line is naming the program it was
		// already told not to name; dropping it is kinder than failing on a
		// formality, and the rest of the entries are used as they came.
		const named = entries[0] === executable || entries[0] === "agent-browser";
		const command = named ? entries.slice(1) : entries;

		if (command.length === 0 || command[0]?.trim() === "")
			throw new Error(
				'browser_run needs a command, for example ["tab", "list"]',
			);

		return { args: command };
	}
}

export const runTool = new RunTool();

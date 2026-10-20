/**
 * `checks` — the project's own checks, by name.
 *
 * The tool accepts a recipe name or `all`, never a command: the model picks
 * what to run and the repository owns how. That is what keeps a policy on this
 * one tool covering every check, and keeps a typo from becoming a shell command.
 *
 * The answer is the whole run — one entry per recipe, with its status, counts,
 * and failures. The model reads a compact text projection of it, and the same
 * value rides the result as the card the user sees.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
	type CheckResult,
	type ChecksCard,
	checkLabel,
	durationLabel,
	locationLabel,
} from "../shared/checks";
import { ALL_RECIPES, RecipeBook } from "./config";
import { ProjectDirectory } from "./files";
import type { RecipeRunner } from "./runner";
import { tailLines } from "./text";

/** How many failures the model's text carries; the card carries the rest. */
const MODEL_FAILURES = 20;

/** How many lines of unparsed output the model's text carries. */
const MODEL_OUTPUT_LINES = 15;

/** What the tool needs from the plugin. */
export interface CheckToolDeps {
	readonly ctx: Context;
	readonly runner: RecipeRunner;
}

class CheckTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = "checks";

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - host context and the runner that owns command execution.
	 */
	create = (deps: CheckToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Run this project's configured checks — lint, typecheck, tests, build — and report " +
			"each one's status, counts and failures, with a card under your answer. The recipes " +
			"are the project's own: `dsh-checks.json` in the project root lists them, so you pick " +
			"a check and the repository owns the command. Prefer this over `bash` for checks.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				name: {
					type: "string",
					description:
						`Recipe to run: a name from dsh-checks.json, or "${ALL_RECIPES}" for every ` +
						"recipe in config order. Omit to run them all. A command line is not accepted.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					callId: { type: "string" },
					ok: { type: "boolean" },
					checks: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								command: { type: "string" },
								parser: { type: "string" },
								status: { type: "string" },
								durationMs: { type: "number" },
								exitCode: { oneOf: [{ type: "number" }, { type: "null" }] },
								summary: { type: "object", additionalProperties: true },
								failures: {
									type: "array",
									items: { type: "object", additionalProperties: true },
								},
								output: { type: "string" },
							},
							required: [
								"name",
								"command",
								"parser",
								"status",
								"durationMs",
								"exitCode",
								"summary",
								"failures",
							],
						},
					},
				},
				required: ["callId", "ok", "checks"],
			},
			render: (_args, value) => [
				{ type: "text", text: this.describe(value as unknown as ChecksCard) },
			],
			// The browser half reads this back as `result.meta` and draws the card.
			// It never reaches the model: the text above is what the model reads.
			presentationMeta: (_args, value) => value,
		},
		execute: async (rawArgs, exec) => {
			const project = new ProjectDirectory(
				deps.ctx,
				await this.cwdFor(deps, exec),
			);
			const book = await RecipeBook.read(project);
			const checks: CheckResult[] = [];

			for (const recipe of book.select(this.parseName(rawArgs))) {
				exec.signal.throwIfAborted();
				checks.push(
					await deps.runner.run(recipe, {
						cwd: project.cwd,
						signal: exec.signal,
					}),
				);
			}

			return {
				callId: String(exec.callId),
				ok: checks.every((check) => check.status === "passed"),
				checks,
			} satisfies ChecksCard;
		},
	});

	/** The recipe name the model asked for, or undefined for all of them. */
	private parseName(rawArgs: unknown): string | undefined {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		return typeof args.name === "string" && args.name !== ""
			? args.name
			: undefined;
	}

	/** The directory the calling session works in. */
	private async cwdFor(
		deps: CheckToolDeps,
		exec: ToolRunContext,
	): Promise<string> {
		if (exec.agent === undefined) return process.cwd();

		return await deps.ctx.workingDirectory.ensure(exec.agent, exec.signal);
	}

	/** The text the model reads: one line per check, then what it found. */
	private describe(card: ChecksCard): string {
		const passed = card.checks.filter((check) => check.status === "passed");
		const lines = [`${passed.length} of ${card.checks.length} checks passed.`];

		for (const check of card.checks) lines.push(...this.lines(check));

		return lines.join("\n");
	}

	/** One check's line, its failures, and the output nothing parsed. */
	private lines(check: CheckResult): string[] {
		const mark = check.status === "passed" ? "✓" : "✗";
		const lines = [
			`${mark} ${check.name} — ${checkLabel(check)} (${durationLabel(check.durationMs)})`,
		];

		for (const failure of check.failures.slice(0, MODEL_FAILURES)) {
			const where = locationLabel(failure);

			lines.push(
				`  ${where === undefined ? "" : `${where} `}${failure.message}`,
			);
		}

		const dropped = check.failures.length - MODEL_FAILURES;
		if (dropped > 0) lines.push(`  … ${dropped} more`);

		if (check.output !== undefined)
			for (const line of tailLines(check.output, MODEL_OUTPUT_LINES).split(
				"\n",
			))
				lines.push(`  ${line}`);

		return lines;
	}
}

export const checkTool = new CheckTool();

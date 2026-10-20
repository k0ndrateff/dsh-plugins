/**
 * Running one recipe: the command, its deadline, and the reading of its output.
 *
 * The command goes through `ctx.shell`, the seam the `bash` tool itself runs on,
 * so a recipe inherits the harness's shell, environment, working directory, and
 * sandbox policy instead of a second, subtly different way to start a process.
 *
 * The parser reads stdout, and stderr only when stdout said nothing the parser
 * understands — a tool that reports on the error stream is read, and one that
 * reports on both is not counted twice. A run nothing could be read from keeps
 * the tail of its output, which is what turns an unreadable check into a
 * visible one.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ShellRunResult } from "@deepseek-ai/dsh-shell";
import {
	type CheckResult,
	type CheckSummary,
	OUTPUT_TAIL_LINES,
} from "../shared/checks";
import type { Recipe } from "./config";
import { type ParsedOutput, parserNamed } from "./parsers/index";
import { errorText, tailLines } from "./text";

/** How long a recipe may run when its own config names no deadline. */
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Every count one parser reported, added up. */
function counted(summary: CheckSummary): number {
	return (
		summary.errors +
		summary.warnings +
		summary.testsPassed +
		summary.testsFailed +
		summary.testsSkipped
	);
}

export class RecipeRunner {
	/** @param ctx - host context carrying the shell seam. */
	constructor(private readonly ctx: Context) {}

	/**
	 * Run one recipe to completion.
	 * @param recipe - the command, its parser, and its deadline.
	 * @param options - the project directory and the caller's cancellation.
	 * @returns the run's status, counts, and failures; never throws for a
	 *   failing command, and only reports infrastructure failures as `errored`.
	 */
	async run(
		recipe: Recipe,
		options: { readonly cwd: string; readonly signal?: AbortSignal },
	): Promise<CheckResult> {
		const started = Date.now();
		const timeoutMs = recipe.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		try {
			const execution = await this.ctx.shell.execute(
				this.ctx.shell.resolve({
					command: recipe.run,
					workdir: options.cwd,
					timeoutMs,
					...(options.signal === undefined ? {} : { signal: options.signal }),
				}),
			);

			return this.read(recipe, await execution.result(), Date.now() - started);
		} catch (error) {
			return {
				name: recipe.name,
				command: recipe.run,
				parser: recipe.parser,
				status: "errored",
				durationMs: Date.now() - started,
				exitCode: null,
				summary: {
					errors: 0,
					warnings: 0,
					testsPassed: 0,
					testsFailed: 0,
					testsSkipped: 0,
				},
				failures: [],
				output: errorText(error),
			};
		}
	}

	/** Turn one finished process into a result. */
	private read(
		recipe: Recipe,
		result: ShellRunResult,
		durationMs: number,
	): CheckResult {
		const parsed = this.parse(recipe, result);
		const text = [result.stdout.text, result.stderr.text]
			.filter((stream) => stream.trim() !== "")
			.join("\n");
		const understood =
			parsed.failures.length > 0 || counted(parsed.summary) > 0;
		const status = this.statusOf(result);
		const output =
			status === "timedout" || !understood
				? tailLines(
						status === "timedout"
							? `${text}\n[no result: the recipe was still running at ${result.timeoutMs}ms]`
							: text,
						OUTPUT_TAIL_LINES,
					)
				: undefined;

		return {
			name: recipe.name,
			command: recipe.run,
			parser: recipe.parser,
			status,
			durationMs,
			exitCode: result.exitCode,
			summary: parsed.summary,
			failures: parsed.failures,
			...(output === undefined || output.trim() === "" ? {} : { output }),
		};
	}

	/** How one process ended, before any reading of what it printed. */
	private statusOf(result: ShellRunResult): CheckResult["status"] {
		if (result.timedOut) return "timedout";
		if (result.aborted) return "errored";

		return result.exitCode === 0 ? "passed" : "failed";
	}

	/**
	 * Read both streams and keep what each said.
	 *
	 * A tool may write one report to one stream, or split it: Biome prints its
	 * diagnostics on stderr and its counts on stdout. So both are parsed, the
	 * failures are the ones either stream produced — stdout first, because that
	 * is where a tool with a single report writes it — and each count is the
	 * larger of the two, so a stream that only repeats a count cannot double it.
	 */
	private parse(recipe: Recipe, result: ShellRunResult): ParsedOutput {
		const parse = parserNamed(recipe.parser);
		const fromOut = parse(result.stdout.text);

		if (result.stderr.text === "") return fromOut;

		const fromErr = parse(result.stderr.text);
		const largest = (pick: (summary: CheckSummary) => number): number =>
			Math.max(pick(fromOut.summary), pick(fromErr.summary));

		return {
			summary: {
				errors: largest((summary) => summary.errors),
				warnings: largest((summary) => summary.warnings),
				testsPassed: largest((summary) => summary.testsPassed),
				testsFailed: largest((summary) => summary.testsFailed),
				testsSkipped: largest((summary) => summary.testsSkipped),
			},
			failures:
				fromOut.failures.length > 0 ? fromOut.failures : fromErr.failures,
		};
	}
}

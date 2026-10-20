/**
 * The parser vocabulary: one tool's output in, counts and failures out.
 *
 * A parser is a pure function of the text a command printed, which is what
 * makes every format here testable against a recorded stream instead of a
 * running tool. The runner owns everything around it — the command, the
 * deadline, the exit code, and the fallback to raw output.
 */

import type { CheckFailure, CheckSummary } from "../../shared/checks";

/** What one parser reads out of a command's output. */
export interface ParsedOutput {
	readonly summary: CheckSummary;
	readonly failures: readonly CheckFailure[];
}

/** A pure reader of one tool's output. */
export type Parser = (text: string) => ParsedOutput;

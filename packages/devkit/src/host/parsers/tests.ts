/**
 * Vitest and Jest, in their default non-TTY reporters.
 *
 * Both print a per-file line, then the failing tests of that file, and a final
 * count line; they differ in how they mark each. Vitest names a failing test
 * with `×` and puts the assertion on the `→` line under it, so the message is
 * the two together. Jest names it after a `●` and follows with a code frame and
 * a stack, so the message stays the test's own name and the file is the `FAIL`
 * line above it.
 *
 * A file line is what has a parenthesized count; a test line does not. Neither
 * reporter prints the source line of a failing test here, so a failure carries
 * the file and not a position.
 */

import { type CheckFailure, EMPTY_SUMMARY } from "../../shared/checks";
import type { Parser } from "./parsed";

/** A vitest file line: `✓ test/sum.test.ts (2 tests) 5ms`. */
const VITEST_FILE = /^\s*[✓❯]\s+(\S+)\s+\(\d+ tests?/u;

/** A vitest failing test: `× adds numbers`. */
const VITEST_TEST = /^\s*[×✗]\s+(.+)$/u;

/** The assertion vitest prints under a failing test. */
const VITEST_REASON = /^\s*→\s*(.+)$/u;

/** A jest file line: `FAIL src/sum.test.js`. */
const JEST_FILE = /^FAIL\s+(\S+)/u;

/** A jest failing test: `● adds numbers`. */
const JEST_TEST = /^\s*●\s+(.+)$/u;

/** One count out of a summary line. */
function countIn(text: string, what: string): number {
	const match = new RegExp(`(\\d+) ${what}\\b`, "u").exec(text);
	const value = match?.[1] === undefined ? 0 : Number(match[1]);

	return Number.isFinite(value) ? value : 0;
}

/** The summary counts both reporters print as `Tests  …`. */
function summaryOf(text: string, failures: readonly CheckFailure[]) {
	const line = /^\s*Tests:?\s+(.*)$/mu.exec(text)?.[1] ?? "";
	const fromLine = {
		testsFailed: countIn(line, "failed"),
		testsPassed: countIn(line, "passed"),
		testsSkipped: countIn(line, "skipped") + countIn(line, "todo"),
	};

	if (line !== "") return { ...EMPTY_SUMMARY, ...fromLine };

	return { ...EMPTY_SUMMARY, testsFailed: failures.length };
}

export const parseVitest: Parser = (text) => {
	const failures: CheckFailure[] = [];
	let file = "";

	for (const line of text.split(/\r?\n/u)) {
		const fileLine = VITEST_FILE.exec(line);

		if (fileLine !== null) {
			file = fileLine[1] ?? "";

			continue;
		}

		const test = VITEST_TEST.exec(line);

		if (test !== null) {
			failures.push({
				...(file === "" ? {} : { file }),
				message: test[1] ?? "",
				severity: "error",
			});

			continue;
		}

		const reason = VITEST_REASON.exec(line);
		const last = failures.at(-1);

		if (reason !== null && last !== undefined)
			failures[failures.length - 1] = {
				...last,
				message: `${last.message} — ${reason[1] ?? ""}`,
			};
	}

	return { summary: summaryOf(text, failures), failures };
};

export const parseJest: Parser = (text) => {
	const failures: CheckFailure[] = [];
	let file = "";

	for (const line of text.split(/\r?\n/u)) {
		const fileLine = JEST_FILE.exec(line);

		if (fileLine !== null) {
			file = fileLine[1] ?? "";

			continue;
		}

		const test = JEST_TEST.exec(line);

		if (test !== null)
			failures.push({
				...(file === "" ? {} : { file }),
				message: test[1] ?? "",
				severity: "error",
			});
	}

	return { summary: summaryOf(text, failures), failures };
};

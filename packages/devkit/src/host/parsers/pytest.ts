/**
 * pytest, in its default reporter.
 *
 * The failures themselves are listed once, in the short summary:
 *
 *   FAILED tests/test_math.py::test_add - assert 3 == 4
 *
 * and the line to open is in the traceback above it, as the last frame of the
 * test that failed:
 *
 *   tests/test_math.py:9: AssertionError
 *
 * Nothing links the two, so positions are assigned to a file's failures in the
 * order both appear — the tracebacks are printed in the same order as the
 * summary. A file whose traceback carried no position simply keeps none.
 */

import { type CheckFailure, EMPTY_SUMMARY } from "../../shared/checks";
import type { Parser } from "./parsed";

/** One entry of the short summary: `FAILED path::test - reason`. */
const OUTCOME = /^(FAILED|ERROR) (\S+?)(?:::(.+?))?(?: - (.*))?$/u;

/** A traceback frame's own line: `tests/test_math.py:9: AssertionError`. */
const FRAME = /^(\S+\.py):(\d+): /u;

/** The final count line: `2 failed, 1 passed, 1 skipped in 0.02s`. */
function countIn(text: string, what: string): number {
	const match = new RegExp(`(\\d+) ${what}\\b`, "u").exec(text);
	const value = match?.[1] === undefined ? 0 : Number(match[1]);

	return Number.isFinite(value) ? value : 0;
}

export const parsePytest: Parser = (text) => {
	const positions = new Map<string, number[]>();
	const failures: CheckFailure[] = [];
	let errors = 0;

	for (const line of text.split(/\r?\n/u)) {
		const frame = FRAME.exec(line);

		if (frame !== null) {
			const file = frame[1] ?? "";
			const queue = positions.get(file) ?? [];

			queue.push(Number(frame[2]));
			positions.set(file, queue);

			continue;
		}

		const outcome = OUTCOME.exec(line);

		if (outcome === null) continue;

		const file = outcome[2] ?? "";
		const line_ = positions.get(file)?.shift();
		const test = outcome[3];
		const reason = outcome[4];

		if (outcome[1] === "ERROR") errors += 1;

		failures.push({
			file,
			...(line_ === undefined ? {} : { line: line_ }),
			message: [test, reason].filter(Boolean).join(" — ") || file,
			severity: "error",
		});
	}

	return {
		summary: {
			...EMPTY_SUMMARY,
			errors,
			testsFailed: countIn(text, "failed") || failures.length,
			testsPassed: countIn(text, "passed"),
			testsSkipped: countIn(text, "skipped"),
		},
		failures,
	};
};

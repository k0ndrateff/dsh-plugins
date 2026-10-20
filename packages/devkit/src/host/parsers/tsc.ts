/**
 * `tsc` diagnostics.
 *
 * The compiler prints one line per diagnostic:
 *
 *   src/config.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.
 *
 * A diagnostic that belongs to no file — a bad compiler option, a missing
 * project — is the same line without the location, and is kept without a file
 * rather than dropped. Pretty output (a TTY, or `--pretty`) is a different
 * layout this parser does not read; the runner then falls back to raw output,
 * which is what makes a misconfigured recipe visible instead of silently empty.
 */

import { type CheckFailure, EMPTY_SUMMARY } from "../../shared/checks";
import type { Parser } from "./parsed";

/** One diagnostic with a source location. */
const LOCATED = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/u;

/** One diagnostic the compiler attributes to no file. */
const UNLOCATED = /^(error|warning) (TS\d+): (.*)$/u;

export const parseTsc: Parser = (text) => {
	const failures: CheckFailure[] = [];
	let errors = 0;
	let warnings = 0;

	const push = (failure: CheckFailure): void => {
		failures.push(failure);

		if (failure.severity === "warning") warnings += 1;
		else errors += 1;
	};

	for (const line of text.split(/\r?\n/u)) {
		const located = LOCATED.exec(line);

		if (located !== null) {
			const severity = located[4] === "warning" ? "warning" : "error";

			push({
				file: located[1] ?? "",
				line: Number(located[2]),
				column: Number(located[3]),
				rule: located[5] ?? "",
				message: located[6] ?? "",
				severity,
			});

			continue;
		}

		const unlocated = UNLOCATED.exec(line);

		if (unlocated !== null)
			push({
				rule: unlocated[2] ?? "",
				message: unlocated[3] ?? "",
				severity: unlocated[1] === "warning" ? "warning" : "error",
			});
	}

	return {
		summary: { ...EMPTY_SUMMARY, errors, warnings },
		failures,
	};
};

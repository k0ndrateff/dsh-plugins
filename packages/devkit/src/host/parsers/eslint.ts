/**
 * ESLint's default `stylish` formatter.
 *
 * Each file is introduced by a path line at column zero, followed by one
 * indented line per problem:
 *
 *   src/app.js
 *     12:5  error    'x' is assigned a value but never used  no-unused-vars
 *     15:1  warning  Missing semicolon                        semi
 *
 * The message and the rule are separated by the formatter's own column padding,
 * so the rule is whatever follows two or more spaces; a problem the formatter
 * prints without a rule keeps none.
 */

import { type CheckFailure, EMPTY_SUMMARY } from "../../shared/checks";
import type { Parser } from "./parsed";

/** One indented problem line: position, severity, message, and rule. */
const PROBLEM = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*)$/u;

/** Padding the formatter uses between the message and the rule. */
const PADDING = /\s{2,}/u;

export const parseEslint: Parser = (text) => {
	const failures: CheckFailure[] = [];
	let errors = 0;
	let warnings = 0;
	let file = "";

	for (const line of text.split(/\r?\n/u)) {
		if (line.trim() === "") continue;

		if (!/^\s/u.test(line)) {
			// A file header, or the summary line that starts with a marker.
			if (!line.startsWith("✖") && !line.startsWith("✔")) file = line.trim();

			continue;
		}

		const problem = PROBLEM.exec(line);

		if (problem === null) continue;

		const severity = problem[3] === "warning" ? "warning" : "error";
		const [message = "", rule] = (problem[4] ?? "").split(PADDING);

		failures.push({
			...(file === "" ? {} : { file }),
			line: Number(problem[1]),
			column: Number(problem[2]),
			message,
			...(rule === undefined || rule === "" ? {} : { rule }),
			severity,
		});

		if (severity === "warning") warnings += 1;
		else errors += 1;
	}

	return { summary: { ...EMPTY_SUMMARY, errors, warnings }, failures };
};

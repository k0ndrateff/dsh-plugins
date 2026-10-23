/**
 * Reading the CLI's report about the machine.
 *
 * The shape is the one `doctor --json` was seen to print: a bare list of checks,
 * with no command envelope around it. Only failures are carried further, because
 * "not installed" and "installed but Chrome is missing" are different sentences
 * to the person who has to fix it.
 *
 *   bun run test/status.ts
 */

import { expect, test } from "bun:test";
import { parseDoctor, summarizeDoctor } from "../src/host/status";

const report_ = JSON.stringify({
	checks: [
		{
			category: "Environment",
			id: "env.version",
			message: "CLI version 0.35.1 (macos aarch64)",
			status: "pass",
		},
		{
			category: "Environment",
			id: "env.socket_dir",
			message: "Socket directory does not exist yet",
			status: "info",
		},
		{
			category: "Chrome",
			id: "chrome.installed",
			message: "Google Chrome 155.0.8059.86 at /Applications/Google Chrome",
			status: "pass",
		},
	],
});

test("doctor's own report", async () => {
	const parsed = parseDoctor(report_);
	expect(parsed !== undefined, "is read").toBe(true);
	expect(parsed?.checks.length === 3, "with every check").toBe(true);

	const summary = summarizeDoctor(parsed ?? { checks: [] });
	expect(
		summary.version === "0.35.1 (macos aarch64)",
		"the version is unwrapped",
	).toBe(true);
	expect(
		summary.chrome?.startsWith("Google Chrome 155") === true,
		"Chrome is named as doctor named it",
	).toBe(true);
	expect(summary.failing.length === 0, "nothing failed").toBe(true);
});
test("a machine something is wrong with", async () => {
	const broken = summarizeDoctor(
		parseDoctor(
			JSON.stringify({
				checks: [
					{
						category: "Chrome",
						id: "chrome.installed",
						message: "no Chrome found",
						status: "fail",
					},
					{
						category: "Environment",
						id: "env.disk_free",
						message: "1 GB free",
						status: "warn",
					},
				],
			}),
		) ?? { checks: [] },
	);
	expect(
		broken.failing.length === 1 &&
			broken.failing[0] === "chrome.installed: no Chrome found",
		"only failures are carried",
	).toBe(true);
	expect(broken.version === undefined, "a missing version is undefined").toBe(
		true,
	);
	expect(broken.chrome === undefined, "a missing Chrome is undefined").toBe(
		true,
	);
});
test("answers that are not a report", async () => {
	expect(
		parseDoctor('{"success":true}') === undefined,
		"a command envelope is not one",
	).toBe(true);
	expect(parseDoctor("{nope") === undefined, "broken JSON is not one").toBe(
		true,
	);
	expect(parseDoctor("") === undefined, "nothing is not one").toBe(true);
	expect(
		parseDoctor('{"checks":[{"id":"env.version"}]}') === undefined,
		"a report with a malformed check is not one",
	).toBe(true);
});

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

import { parseDoctor, summarizeDoctor } from "../src/host/status";
import { check, report, section } from "./harness";

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

section("doctor's own report");
const parsed = parseDoctor(report_);
check("is read", parsed !== undefined);
check("with every check", parsed?.checks.length === 3);

const summary = summarizeDoctor(parsed ?? { checks: [] });
check("the version is unwrapped", summary.version === "0.35.1 (macos aarch64)");
check(
	"Chrome is named as doctor named it",
	summary.chrome?.startsWith("Google Chrome 155") === true,
);
check("nothing failed", summary.failing.length === 0);

section("a machine something is wrong with");
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
check(
	"only failures are carried",
	broken.failing.length === 1 &&
		broken.failing[0] === "chrome.installed: no Chrome found",
);
check("a missing version is undefined", broken.version === undefined);
check("a missing Chrome is undefined", broken.chrome === undefined);

section("answers that are not a report");
check(
	"a command envelope is not one",
	parseDoctor('{"success":true}') === undefined,
);
check("broken JSON is not one", parseDoctor("{nope") === undefined);
check("nothing is not one", parseDoctor("") === undefined);
check(
	"a report with a malformed check is not one",
	parseDoctor('{"checks":[{"id":"env.version"}]}') === undefined,
);

report();

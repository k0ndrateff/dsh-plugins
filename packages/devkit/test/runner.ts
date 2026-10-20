/**
 * The runner: what it does with an exit code, a deadline, and two streams.
 *
 * Most cases are scripted — a fake shell seam answers with the exact result each
 * one needs, which is the only way to test a timeout without waiting for one.
 * The last section runs real commands through a seam that really spawns them, so
 * the pipeline is proved end to end on live output and not only on fixtures.
 *
 *   bun run test/runner.ts
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {
	ShellExecRequest,
	ShellExecSpec,
	ShellExecution,
	ShellRunResult,
} from "@deepseek-ai/dsh-shell";
import type { Recipe } from "../src/host/config";
import { DEFAULT_TIMEOUT_MS, RecipeRunner } from "../src/host/runner";
import { check, report, section } from "./harness";

/** One scripted run: what the fake process printed and how it ended. */
interface Scripted {
	readonly stdout?: string;
	readonly stderr?: string;
	readonly exitCode?: number | null;
	readonly timedOut?: boolean;
	readonly aborted?: boolean;
}

/** A shell seam that answers from a script, and records the spec it was given. */
function scriptedShell(script: Scripted | Error): {
	ctx: Context;
	specs: ShellExecSpec[];
} {
	const specs: ShellExecSpec[] = [];

	const ctx = {
		shell: {
			resolve: (request: ShellExecRequest): ShellExecSpec => ({
				command: request.command,
				workdir: request.workdir ?? "",
				timeoutMs: request.timeoutMs ?? 0,
				onExpiry: request.onExpiry ?? "kill",
				stdoutMaxBytes: 1_000_000,
				signal: request.signal,
				sandboxPolicy: undefined,
			}),
			execute: async (spec: ShellExecSpec): Promise<ShellExecution> => {
				specs.push(spec);

				if (script instanceof Error) throw script;

				const result: ShellRunResult = {
					exitCode: script.exitCode === undefined ? 0 : script.exitCode,
					signal: null,
					timedOut: script.timedOut ?? false,
					aborted: script.aborted ?? false,
					timeoutMs: spec.timeoutMs,
					stdout: { text: script.stdout ?? "", truncated: false },
					stderr: { text: script.stderr ?? "", truncated: false },
				};

				return {
					status: "completed",
					exitCode: result.exitCode,
					signal: null,
					done: Promise.resolve(),
					readOutput: () => ({ delta: "", lossy: false }),
					observed: {},
					kill: () => false,
					result: async () => result,
				} as unknown as ShellExecution;
			},
		},
	} as unknown as Context;

	return { ctx, specs };
}

/** Run one command line for real, through the platform shell. */
function run(command: string, cwd: string): Promise<ShellRunResult> {
	return new Promise((resolve) => {
		const child = spawn("/bin/sh", ["-c", command], { cwd });
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => {
			resolve({
				exitCode: code,
				signal: null,
				timedOut: false,
				aborted: false,
				timeoutMs: 0,
				stdout: { text: stdout, truncated: false },
				stderr: { text: stderr, truncated: false },
			});
		});
	});
}

/** A shell seam that really spawns what it is asked to run. */
function liveShell(): Context {
	return {
		shell: {
			resolve: (request: ShellExecRequest): ShellExecSpec => ({
				command: request.command,
				workdir: request.workdir ?? "",
				timeoutMs: request.timeoutMs ?? 0,
				onExpiry: request.onExpiry ?? "kill",
				stdoutMaxBytes: 1_000_000,
				signal: request.signal,
				sandboxPolicy: undefined,
			}),
			execute: async (spec: ShellExecSpec): Promise<ShellExecution> =>
				({
					result: async () => await run(spec.command, spec.workdir),
				}) as unknown as ShellExecution,
		},
	} as unknown as Context;
}

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
	name: "check",
	run: "bun run check",
	parser: "generic",
	...over,
});

section("what the runner asks the shell for");
{
	const { ctx, specs } = scriptedShell({});
	await new RecipeRunner(ctx).run(
		recipe({ run: "bun run typecheck", parser: "tsc", timeoutMs: 5_000 }),
		{ cwd: "/work/app" },
	);

	check(
		"the project's command line goes through unchanged",
		specs[0]?.command === "bun run typecheck",
		specs[0]?.command,
	);
	check(
		"the session's directory is the working directory",
		specs[0]?.workdir === "/work/app",
		specs[0]?.workdir,
	);
	check(
		"a recipe's own deadline is used",
		specs[0]?.timeoutMs === 5_000,
		String(specs[0]?.timeoutMs),
	);

	const { ctx: other, specs: defaults } = scriptedShell({});
	await new RecipeRunner(other).run(recipe(), { cwd: "/work/app" });

	check(
		"a recipe without one gets the runner's default",
		defaults[0]?.timeoutMs === DEFAULT_TIMEOUT_MS,
		String(defaults[0]?.timeoutMs),
	);
}

section("how a run ends");
{
	const cases: [string, Scripted | Error, string, number | null][] = [
		["a clean exit passes", { exitCode: 0 }, "passed", 0],
		["a non-zero exit fails", { exitCode: 3 }, "failed", 3],
		[
			"a killed deadline times out",
			{ timedOut: true, exitCode: null },
			"timedout",
			null,
		],
		[
			"a cancelled run is not a failure of the check",
			{ aborted: true, exitCode: null },
			"errored",
			null,
		],
		[
			"a process that never started is an error",
			new Error("no shell"),
			"errored",
			null,
		],
	];

	for (const [label, script, status, exitCode] of cases) {
		const { ctx } = scriptedShell(script);
		const result = await new RecipeRunner(ctx).run(recipe(), { cwd: "/work" });

		check(
			label,
			result.status === status && result.exitCode === exitCode,
			`${result.status}/${String(result.exitCode)}`,
		);
	}

	const { ctx } = scriptedShell(new Error("no shell"));
	const failed = await new RecipeRunner(ctx).run(recipe(), { cwd: "/work" });

	check(
		"an error says why in place of output",
		failed.output === "no shell",
		failed.output,
	);
}

section("reading the two streams");
{
	const { ctx } = scriptedShell({
		exitCode: 1,
		stdout: "src/a.ts(4,2): error TS2322: nope\n",
	});
	const parsed = await new RecipeRunner(ctx).run(recipe({ parser: "tsc" }), {
		cwd: "/work",
	});

	check(
		"stdout is what gets parsed",
		parsed.status === "failed" &&
			parsed.summary.errors === 1 &&
			parsed.failures[0]?.file === "src/a.ts",
		JSON.stringify(parsed.failures[0]),
	);
	check(
		"a parsed run keeps no raw output",
		parsed.output === undefined,
		String(parsed.output),
	);

	const { ctx: onError } = scriptedShell({
		exitCode: 1,
		stderr: "src/b.ts(7,1): error TS1005: oops\n",
	});
	const fromStderr = await new RecipeRunner(onError).run(
		recipe({ parser: "tsc" }),
		{ cwd: "/work" },
	);

	check(
		"a tool that reports on stderr is read too",
		fromStderr.failures[0]?.file === "src/b.ts",
		JSON.stringify(fromStderr.failures[0]),
	);

	// Biome splits its report: the diagnostics on stderr, the counts on stdout.
	const { ctx: split } = scriptedShell({
		exitCode: 1,
		stdout:
			"Checked 107 files in 72ms. No fixes applied.\nFound 2 errors.\nFound 1 warning.\n",
		stderr: [
			"src/a.ts:2:1 lint/style/useConst  FIXABLE  ━━━━━━━━━━━",
			"",
			"  ! This let declares a variable that is only assigned once.",
			"",
			"src/b.ts:3:11 lint/suspicious/noDoubleEquals  FIXABLE  ━━━",
			"",
			"  × Using == may be unsafe if you are relying on type coercion.",
		].join("\n"),
	});
	const both = await new RecipeRunner(split).run(recipe({ parser: "biome" }), {
		cwd: "/work",
	});

	check(
		"a report split across the two streams is read from both",
		both.failures.length === 2 &&
			both.failures[0]?.file === "src/a.ts" &&
			both.failures[1]?.severity === "error",
		JSON.stringify(both.failures),
	);
	check(
		"a count a stream only repeats is not doubled",
		both.summary.errors === 2 && both.summary.warnings === 1,
		JSON.stringify(both.summary),
	);

	const { ctx: unreadable } = scriptedShell({
		exitCode: 2,
		stdout: "boom: everything is on fire\nsecond line\n",
	});
	const kept = await new RecipeRunner(unreadable).run(recipe(), {
		cwd: "/work",
	});

	check(
		"a run nothing could be read from keeps its output",
		kept.status === "failed" &&
			(kept.output ?? "").includes("everything is on fire"),
		kept.output,
	);

	const { ctx: timedOut } = scriptedShell({
		stdout: "still going\n",
		timedOut: true,
		exitCode: null,
	});
	const expired = await new RecipeRunner(timedOut).run(recipe(), {
		cwd: "/work",
	});

	check(
		"a timed-out run says so and keeps what it printed",
		expired.status === "timedout" &&
			(expired.output ?? "").includes("still running"),
		expired.output,
	);

	// A tool may report on both streams at once, and each report is a finding.
	const { ctx: onBoth } = scriptedShell({
		exitCode: 1,
		stdout: "src/a.ts(1,1): error TS1: from stdout\n",
		stderr: "src/b.ts(2,2): error TS2: from stderr\n",
	});
	const two = await new RecipeRunner(onBoth).run(recipe({ parser: "tsc" }), {
		cwd: "/work",
	});

	check(
		"failures on both streams are all kept",
		two.failures.length === 2 &&
			two.failures[0]?.file === "src/a.ts" &&
			two.failures[1]?.file === "src/b.ts",
		JSON.stringify(two.failures.map((failure) => failure.file)),
	);

	const { ctx: twice } = scriptedShell({
		exitCode: 1,
		stdout: "src/a.ts(1,1): error TS1: same\n",
		stderr: "src/a.ts(1,1): error TS1: same\n",
	});
	const once = await new RecipeRunner(twice).run(recipe({ parser: "tsc" }), {
		cwd: "/work",
	});

	check(
		"the same failure written twice is read once",
		once.failures.length === 1,
		JSON.stringify(once.failures),
	);
}

section("live: real commands through a real process");
{
	const runner = new RecipeRunner(liveShell());
	// The runtime running this file, by its own path: a bare `node` would make
	// the check depend on the PATH of whatever shell happens to run the suite.
	const runtime = process.execPath;

	const ok = await runner.run(
		recipe({ run: `${runtime} -e "console.log('ok')"` }),
		{ cwd: process.cwd() },
	);

	check(
		"a real passing command passes",
		ok.status === "passed" && ok.exitCode === 0 && ok.durationMs >= 0,
		`${ok.status}/${String(ok.exitCode)}/${ok.durationMs}ms`,
	);

	const bad = await runner.run(
		recipe({ run: `${runtime} -e "process.exit(3)"` }),
		{ cwd: process.cwd() },
	);

	check(
		"a real failing command fails with its exit code",
		bad.status === "failed" && bad.exitCode === 3,
		`${bad.status}/${String(bad.exitCode)}`,
	);

	// The fixture lives in a directory of its own, because a suite that writes
	// into its own package leaves a file behind when it fails and cannot write at
	// all under a sandbox that allows only temporary areas.
	const fixture = "runner-fixture.ts";
	const dir = mkdtempSync(join(tmpdir(), "devkit-runner-"));
	const tsc = new URL("../../../node_modules/.bin/tsc", import.meta.url)
		.pathname;

	writeFileSync(join(dir, fixture), 'export const count: number = "three";\n');

	try {
		const typed = await runner.run(
			recipe({ run: `${tsc} --noEmit --strict ${fixture}`, parser: "tsc" }),
			{ cwd: dir },
		);

		check(
			"a real tsc run is parsed into a failure at the right line",
			typed.status === "failed" &&
				typed.failures[0]?.file === fixture &&
				typed.failures[0]?.line === 1 &&
				typed.failures[0]?.rule === "TS2322",
			JSON.stringify(typed.failures[0]),
		);
		check(
			"the compiler's error count reaches the summary",
			typed.summary.errors === 1,
			JSON.stringify(typed.summary),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

report();

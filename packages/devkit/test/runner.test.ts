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

import { expect, test } from "bun:test";
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

test("what the runner asks the shell for", async () => {
	{
		const { ctx, specs } = scriptedShell({});
		await new RecipeRunner(ctx).run(
			recipe({ run: "bun run typecheck", parser: "tsc", timeoutMs: 5_000 }),
			{ cwd: "/work/app" },
		);

		expect(
			specs[0]?.command === "bun run typecheck",
			`the project's command line goes through unchanged — ${specs[0]?.command}`,
		).toBe(true);
		expect(
			specs[0]?.workdir === "/work/app",
			`the session's directory is the working directory — ${specs[0]?.workdir}`,
		).toBe(true);
		expect(
			specs[0]?.timeoutMs === 5_000,
			`a recipe's own deadline is used — ${String(specs[0]?.timeoutMs)}`,
		).toBe(true);

		const { ctx: other, specs: defaults } = scriptedShell({});
		await new RecipeRunner(other).run(recipe(), { cwd: "/work/app" });

		expect(
			defaults[0]?.timeoutMs === DEFAULT_TIMEOUT_MS,
			`a recipe without one gets the runner's default — ${String(defaults[0]?.timeoutMs)}`,
		).toBe(true);
	}
});
test("how a run ends", async () => {
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
			const result = await new RecipeRunner(ctx).run(recipe(), {
				cwd: "/work",
			});

			expect(
				result.status === status && result.exitCode === exitCode,
				String(label) + " — " + `${result.status}/${String(result.exitCode)}`,
			).toBe(true);
		}

		const { ctx } = scriptedShell(new Error("no shell"));
		const failed = await new RecipeRunner(ctx).run(recipe(), { cwd: "/work" });

		expect(
			failed.output === "no shell",
			`an error says why in place of output — ${failed.output}`,
		).toBe(true);
	}
});
test("reading the two streams", async () => {
	{
		const { ctx } = scriptedShell({
			exitCode: 1,
			stdout: "src/a.ts(4,2): error TS2322: nope\n",
		});
		const parsed = await new RecipeRunner(ctx).run(recipe({ parser: "tsc" }), {
			cwd: "/work",
		});

		expect(
			parsed.status === "failed" &&
				parsed.summary.errors === 1 &&
				parsed.failures[0]?.file === "src/a.ts",
			`stdout is what gets parsed — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
		expect(
			parsed.output === undefined,
			`a parsed run keeps no raw output — ${String(parsed.output)}`,
		).toBe(true);

		const { ctx: onError } = scriptedShell({
			exitCode: 1,
			stderr: "src/b.ts(7,1): error TS1005: oops\n",
		});
		const fromStderr = await new RecipeRunner(onError).run(
			recipe({ parser: "tsc" }),
			{ cwd: "/work" },
		);

		expect(
			fromStderr.failures[0]?.file === "src/b.ts",
			`a tool that reports on stderr is read too — ${JSON.stringify(fromStderr.failures[0])}`,
		).toBe(true);

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
		const both = await new RecipeRunner(split).run(
			recipe({ parser: "biome" }),
			{
				cwd: "/work",
			},
		);

		expect(
			both.failures.length === 2 &&
				both.failures[0]?.file === "src/a.ts" &&
				both.failures[1]?.severity === "error",
			`a report split across the two streams is read from both — ${JSON.stringify(both.failures)}`,
		).toBe(true);
		expect(
			both.summary.errors === 2 && both.summary.warnings === 1,
			`a count a stream only repeats is not doubled — ${JSON.stringify(both.summary)}`,
		).toBe(true);

		const { ctx: unreadable } = scriptedShell({
			exitCode: 2,
			stdout: "boom: everything is on fire\nsecond line\n",
		});
		const kept = await new RecipeRunner(unreadable).run(recipe(), {
			cwd: "/work",
		});

		expect(
			kept.status === "failed" &&
				(kept.output ?? "").includes("everything is on fire"),
			`a run nothing could be read from keeps its output — ${kept.output}`,
		).toBe(true);

		const { ctx: timedOut } = scriptedShell({
			stdout: "still going\n",
			timedOut: true,
			exitCode: null,
		});
		const expired = await new RecipeRunner(timedOut).run(recipe(), {
			cwd: "/work",
		});

		expect(
			expired.status === "timedout" &&
				(expired.output ?? "").includes("still running"),
			`a timed-out run says so and keeps what it printed — ${expired.output}`,
		).toBe(true);

		// A tool may report on both streams at once, and each report is a finding.
		const { ctx: onBoth } = scriptedShell({
			exitCode: 1,
			stdout: "src/a.ts(1,1): error TS1: from stdout\n",
			stderr: "src/b.ts(2,2): error TS2: from stderr\n",
		});
		const two = await new RecipeRunner(onBoth).run(recipe({ parser: "tsc" }), {
			cwd: "/work",
		});

		expect(
			two.failures.length === 2 &&
				two.failures[0]?.file === "src/a.ts" &&
				two.failures[1]?.file === "src/b.ts",
			`failures on both streams are all kept — ${JSON.stringify(two.failures.map((failure) => failure.file))}`,
		).toBe(true);

		const { ctx: twice } = scriptedShell({
			exitCode: 1,
			stdout: "src/a.ts(1,1): error TS1: same\n",
			stderr: "src/a.ts(1,1): error TS1: same\n",
		});
		const once = await new RecipeRunner(twice).run(recipe({ parser: "tsc" }), {
			cwd: "/work",
		});

		expect(
			once.failures.length === 1,
			`the same failure written twice is read once — ${JSON.stringify(once.failures)}`,
		).toBe(true);
	}
});
test("live: real commands through a real process", async () => {
	{
		const runner = new RecipeRunner(liveShell());
		// The runtime running this file, by its own path: a bare `node` would make
		// the check depend on the PATH of whatever shell happens to run the suite.
		const runtime = process.execPath;

		const ok = await runner.run(
			recipe({ run: `${runtime} -e "console.log('ok')"` }),
			{ cwd: process.cwd() },
		);

		expect(
			ok.status === "passed" && ok.exitCode === 0 && ok.durationMs >= 0,
			`a real passing command passes — ${`${ok.status}/${String(ok.exitCode)}/${ok.durationMs}ms`}`,
		).toBe(true);

		const bad = await runner.run(
			recipe({ run: `${runtime} -e "process.exit(3)"` }),
			{ cwd: process.cwd() },
		);

		expect(
			bad.status === "failed" && bad.exitCode === 3,
			`a real failing command fails with its exit code — ${`${bad.status}/${String(bad.exitCode)}`}`,
		).toBe(true);

		// The fixture lives in a directory of its own, because a suite that writes
		// into its own package leaves a file behind when it fails and cannot write at
		// all under a sandbox that allows only temporary areas.
		const fixture = "runner-fixture.ts";
		const dir = mkdtempSync(join(tmpdir(), "devkit-runner-"));
		const tsc = new URL("../../../node_modules/.bin/tsc", import.meta.url)
			.pathname;

		writeFileSync(
			join(dir, fixture),
			'export const count: number = "three";\n',
		);

		try {
			const typed = await runner.run(
				recipe({ run: `${tsc} --noEmit --strict ${fixture}`, parser: "tsc" }),
				{ cwd: dir },
			);

			expect(
				typed.status === "failed" &&
					typed.failures[0]?.file === fixture &&
					typed.failures[0]?.line === 1 &&
					typed.failures[0]?.rule === "TS2322",
				`a real tsc run is parsed into a failure at the right line — ${JSON.stringify(typed.failures[0])}`,
			).toBe(true);
			expect(
				typed.summary.errors === 1,
				`the compiler's error count reaches the summary — ${JSON.stringify(typed.summary)}`,
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

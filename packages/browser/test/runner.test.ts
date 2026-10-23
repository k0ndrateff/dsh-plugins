/**
 * Running one command, and reading what came back.
 *
 * The subprocess seam is scripted here rather than spawned: a timeout has to be
 * provable without waiting for one, and the answers that matter — a CLI that is
 * not installed, one that printed something unreadable, one that never settled —
 * are exactly the ones a live run rarely produces on demand.
 *
 *   bun run test/runner.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type {
	SubprocessHandle,
	SubprocessOutcome,
	SubprocessSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { BrowserSettings } from "../src/host/config";
import { AgentBrowserRunner, type BrowserCommand } from "../src/host/runner";

/** One scripted answer from the CLI. */
interface Script {
	readonly stdout?: string;
	readonly stderr?: string;
	readonly exitCode?: number | null;
	/** Reject the spawn the way a provider does when the program is gone. */
	readonly spawnFailure?: string;
	/** Keep the process open until its signal aborts. */
	readonly untilAborted?: boolean;
}

/** One collected stream, read after the process settled. */
const readerOf = (text: () => string) => ({
	readFrom: () => ({ text: text(), nextOffset: 0, lossy: false }),
});

/** A subprocess seam that answers from a script instead of spawning anything. */
const scriptedSubprocess = (script: Script, found: boolean) => {
	const specs: SubprocessSpawnSpec[] = [];
	let resolutions = 0;

	const ctx = {
		subprocess: {
			resolveExecutable: async (): Promise<string> => {
				resolutions += 1;
				if (!found) throw new Error("not found on PATH");

				return "/opt/bin/agent-browser";
			},
			spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
				specs.push(spec);

				const done = new Promise<SubprocessOutcome>((resolve, reject) => {
					if (script.spawnFailure !== undefined) {
						reject(new Error(script.spawnFailure));

						return;
					}

					const settle = (): void => resolve({ exitCode: null, signal: null });

					if (script.untilAborted === true) {
						if (spec.signal?.aborted === true) settle();
						else spec.signal?.addEventListener("abort", settle, { once: true });

						return;
					}

					resolve({ exitCode: script.exitCode ?? 0, signal: null });
				});

				return {
					stdin: undefined,
					stdout: undefined,
					stderr: undefined,
					control: undefined,
					collected: {
						stdout: readerOf(() => script.stdout ?? ""),
						stderr: readerOf(() => script.stderr ?? ""),
					},
					done,
					terminate: () => {},
					waitForExit: async () => true,
				} as unknown as SubprocessHandle;
			},
		},
	} as unknown as Context;

	return { ctx, specs, resolutions: () => resolutions };
};

/** A runner over one scripted seam. */
const runnerFor = (
	script: Script,
	config?: Parameters<typeof BrowserSettings.from>[0],
	found = true,
) => {
	const fake = scriptedSubprocess(script, found);
	const runner = new AgentBrowserRunner({
		ctx: fake.ctx,
		config: BrowserSettings.from(config),
	});

	return { runner, specs: fake.specs, resolutions: fake.resolutions };
};

/** One call to this session's browser. */
const command = (
	args: string[],
	overrides: Partial<BrowserCommand> = {},
): BrowserCommand => ({
	args,
	session: "dsh-test",
	cwd: "/tmp/project",
	signal: new AbortController().signal,
	...overrides,
});

test("the command line", async () => {
	const plain = runnerFor({
		stdout: '{"success":true,"data":{"url":"http://x"}}',
	});
	const answered = await plain.runner.run(command(["snapshot", "-i"]));

	expect(
		plain.specs[0]?.argv[0] === "/opt/bin/agent-browser",
		"the executable is what was resolved",
	).toBe(true);
	expect(
		plain.specs[0]?.argv.slice(1, 3).join(" ") === "--session dsh-test",
		"the session is named on every call",
	).toBe(true);
	expect(
		plain.specs[0]?.argv.slice(3).join(" ") === "snapshot -i --json",
		"the command keeps its own arguments",
	).toBe(true);
	expect(
		plain.specs[0]?.cwd === "/tmp/project",
		"the work happens in the session's directory",
	).toBe(true);
	expect(plain.specs[0]?.stdio.stdin === "ignore", "stdin is closed").toBe(
		true,
	);
	expect(
		typeof plain.specs[0]?.stdio.stdout === "object" &&
			typeof plain.specs[0]?.stdio.stderr === "object",
		"both streams are collected",
	).toBe(true);
	expect(
		(plain.specs[0]?.graceMs ?? 0) > 0,
		"the process is given time to go away",
	).toBe(true);
	expect(answered.ok === true, "a good answer is a success").toBe(true);
});
test("the environment the CLI reads", async () => {
	const headed = runnerFor({ stdout: '{"success":true}' }, { headed: true });
	await headed.runner.run(command(["open", "http://x"]));
	expect(
		headed.specs[0]?.env?.AGENT_BROWSER_HEADED === "1",
		"an asked-for window is passed through",
	).toBe(true);

	const bounded = runnerFor(
		{ stdout: '{"success":true}' },
		{ allowedDomains: ["example.com", "*.test"] },
	);
	await bounded.runner.run(command(["open", "http://x"]));
	expect(
		bounded.specs[0]?.env?.AGENT_BROWSER_ALLOWED_DOMAINS ===
			"example.com,*.test",
		"a domain policy is passed through as one list",
	).toBe(true);

	const quiet = runnerFor({ stdout: '{"success":true}' });
	await quiet.runner.run(command(["open", "http://x"]));
	expect(
		quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_MAX_WIDTH === "1280" &&
			quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_MAX_HEIGHT === "800" &&
			quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_QUALITY === "60",
		"a default config asks for the panel's own frame size",
	).toBe(true);
	expect(
		quiet.specs[0]?.env?.AGENT_BROWSER_HEADED === undefined &&
			quiet.specs[0]?.env?.AGENT_BROWSER_ALLOWED_DOMAINS === undefined,
		"and adds no window and no domain policy",
	).toBe(true);

	const profiled = runnerFor(
		{ stdout: '{"success":true}' },
		{ chromeProfile: "Default" },
	);
	await profiled.runner.run(command(["open", "http://x"]));
	expect(
		profiled.specs[0]?.argv.includes("--profile") === true &&
			profiled.specs[0]?.argv.includes("Default") === true,
		"a profile to reuse is named on every call",
	).toBe(true);
	expect(
		quiet.specs[0]?.argv.includes("--profile") === false,
		"and no profile means no flag",
	).toBe(true);
});
test("a CLI that is not installed", async () => {
	const missing = runnerFor({}, undefined, false);
	const absent = await missing.runner.run(command(["open", "http://x"]));
	expect(absent.ok === false, "the call fails").toBe(true);
	expect(
		absent.ok === false &&
			absent.error.includes("npm install -g agent-browser"),
		"the reason says how to install it",
	).toBe(true);
	expect(missing.specs.length === 0, "nothing was spawned").toBe(true);
	expect(
		(await missing.runner.status({
			session: "dsh-test",
			cwd: "/tmp/project",
			signal: new AbortController().signal,
		})) === undefined,
		"and a status check says so by answering nothing",
	).toBe(true);
});
test("resolving the executable once", async () => {
	const twice = runnerFor({ stdout: '{"success":true}' });
	await twice.runner.run(command(["get", "url"]));
	await twice.runner.run(command(["get", "url"]));
	expect(twice.resolutions() === 1, "is enough for two calls").toBe(true);
	expect(twice.specs.length === 2, "and both ran").toBe(true);
});
test("what the CLI answered", async () => {
	const failed = runnerFor({
		stdout:
			'{"error":"Unknown command: frobnicate","success":false,"type":"unknown_command"}',
	});
	const refusal = await failed.runner.run(command(["frobnicate"]));
	expect(refusal.ok === false, "a refusal is a failure").toBe(true);
	expect(
		refusal.ok === false && refusal.error === "Unknown command: frobnicate",
		"with the CLI's own reason",
	).toBe(true);

	const unreadable = runnerFor({ stdout: "✓ Closed session: default" });
	const junk = await unreadable.runner.run(command(["close"]));
	expect(junk.ok === false, "an unreadable answer is a failure").toBe(true);
	expect(
		junk.ok === false && junk.error.includes("✓ Closed session"),
		"and it quotes what came back",
	).toBe(true);

	const crashed = runnerFor({
		stdout: "",
		stderr: "Auto-launch failed: CDP response channel closed\nsecond line",
		exitCode: 1,
	});
	const crash = await crashed.runner.run(command(["open", "http://x"]));
	expect(crash.ok === false, "a crash is reported from stderr").toBe(true);
	expect(
		crash.ok === false && crash.error.includes("Auto-launch failed"),
		"as the tail of what it printed",
	).toBe(true);

	const rejected = runnerFor({ spawnFailure: "spawn failed: ENOENT" });
	const never = await rejected.runner.run(command(["open", "http://x"]));
	expect(never.ok === false, "a rejected spawn is a failure").toBe(true);
	expect(
		never.ok === false && never.error.includes("ENOENT"),
		"with the provider's reason",
	).toBe(true);
});
test("bounds on one call", async () => {
	const stuck = runnerFor({ untilAborted: true });
	const timedOut = await stuck.runner.run(
		command(["open", "http://x"], { timeoutMs: 20 }),
	);
	expect(timedOut.ok === false, "a command that never settles is stopped").toBe(
		true,
	);
	expect(
		timedOut.ok === false && timedOut.error.includes("did not finish within"),
		"and says it ran out of time",
	).toBe(true);

	const cancelled = new AbortController();
	cancelled.abort();
	const abandoned = await runnerFor({ untilAborted: true }).runner.run(
		command(["open", "http://x"], { signal: cancelled.signal }),
	);
	expect(abandoned.ok === false, "a cancelled call is a failure").toBe(true);
	expect(
		abandoned.ok === false && abandoned.error === "the call was cancelled",
		"and is not reported as a timeout",
	).toBe(true);
});

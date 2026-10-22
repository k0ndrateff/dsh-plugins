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

import type { Context } from "@deepseek-ai/cordis";
import type {
	SubprocessHandle,
	SubprocessOutcome,
	SubprocessSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { BrowserSettings } from "../src/host/config";
import { AgentBrowserRunner, type BrowserCommand } from "../src/host/runner";
import { check, report, section } from "./harness";

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

section("the command line");
const plain = runnerFor({
	stdout: '{"success":true,"data":{"url":"http://x"}}',
});
const answered = await plain.runner.run(command(["snapshot", "-i"]));

check(
	"the executable is what was resolved",
	plain.specs[0]?.argv[0] === "/opt/bin/agent-browser",
);
check(
	"the session is named on every call",
	plain.specs[0]?.argv.slice(1, 3).join(" ") === "--session dsh-test",
);
check(
	"the command keeps its own arguments",
	plain.specs[0]?.argv.slice(3).join(" ") === "snapshot -i --json",
);
check(
	"the work happens in the session's directory",
	plain.specs[0]?.cwd === "/tmp/project",
);
check("stdin is closed", plain.specs[0]?.stdio.stdin === "ignore");
check(
	"both streams are collected",
	typeof plain.specs[0]?.stdio.stdout === "object" &&
		typeof plain.specs[0]?.stdio.stderr === "object",
);
check(
	"the process is given time to go away",
	(plain.specs[0]?.graceMs ?? 0) > 0,
);
check("a good answer is a success", answered.ok === true);

section("the environment the CLI reads");
const headed = runnerFor({ stdout: '{"success":true}' }, { headed: true });
await headed.runner.run(command(["open", "http://x"]));
check(
	"an asked-for window is passed through",
	headed.specs[0]?.env?.AGENT_BROWSER_HEADED === "1",
);

const bounded = runnerFor(
	{ stdout: '{"success":true}' },
	{ allowedDomains: ["example.com", "*.test"] },
);
await bounded.runner.run(command(["open", "http://x"]));
check(
	"a domain policy is passed through as one list",
	bounded.specs[0]?.env?.AGENT_BROWSER_ALLOWED_DOMAINS === "example.com,*.test",
);

const quiet = runnerFor({ stdout: '{"success":true}' });
await quiet.runner.run(command(["open", "http://x"]));
check(
	"a default config asks for the panel's own frame size",
	quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_MAX_WIDTH === "1280" &&
		quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_MAX_HEIGHT === "800" &&
		quiet.specs[0]?.env?.AGENT_BROWSER_STREAM_QUALITY === "60",
);
check(
	"and adds no window and no domain policy",
	quiet.specs[0]?.env?.AGENT_BROWSER_HEADED === undefined &&
		quiet.specs[0]?.env?.AGENT_BROWSER_ALLOWED_DOMAINS === undefined,
);

const profiled = runnerFor(
	{ stdout: '{"success":true}' },
	{ chromeProfile: "Default" },
);
await profiled.runner.run(command(["open", "http://x"]));
check(
	"a profile to reuse is named on every call",
	profiled.specs[0]?.argv.includes("--profile") === true &&
		profiled.specs[0]?.argv.includes("Default") === true,
);
check(
	"and no profile means no flag",
	quiet.specs[0]?.argv.includes("--profile") === false,
);

section("a CLI that is not installed");
const missing = runnerFor({}, undefined, false);
const absent = await missing.runner.run(command(["open", "http://x"]));
check("the call fails", absent.ok === false);
check(
	"the reason says how to install it",
	absent.ok === false && absent.error.includes("npm install -g agent-browser"),
);
check("nothing was spawned", missing.specs.length === 0);
check(
	"and a status check says so by answering nothing",
	(await missing.runner.status({
		session: "dsh-test",
		cwd: "/tmp/project",
		signal: new AbortController().signal,
	})) === undefined,
);

section("resolving the executable once");
const twice = runnerFor({ stdout: '{"success":true}' });
await twice.runner.run(command(["get", "url"]));
await twice.runner.run(command(["get", "url"]));
check("is enough for two calls", twice.resolutions() === 1);
check("and both ran", twice.specs.length === 2);

section("what the CLI answered");
const failed = runnerFor({
	stdout:
		'{"error":"Unknown command: frobnicate","success":false,"type":"unknown_command"}',
});
const refusal = await failed.runner.run(command(["frobnicate"]));
check("a refusal is a failure", refusal.ok === false);
check(
	"with the CLI's own reason",
	refusal.ok === false && refusal.error === "Unknown command: frobnicate",
);

const unreadable = runnerFor({ stdout: "✓ Closed session: default" });
const junk = await unreadable.runner.run(command(["close"]));
check("an unreadable answer is a failure", junk.ok === false);
check(
	"and it quotes what came back",
	junk.ok === false && junk.error.includes("✓ Closed session"),
);

const crashed = runnerFor({
	stdout: "",
	stderr: "Auto-launch failed: CDP response channel closed\nsecond line",
	exitCode: 1,
});
const crash = await crashed.runner.run(command(["open", "http://x"]));
check("a crash is reported from stderr", crash.ok === false);
check(
	"as the tail of what it printed",
	crash.ok === false && crash.error.includes("Auto-launch failed"),
);

const rejected = runnerFor({ spawnFailure: "spawn failed: ENOENT" });
const never = await rejected.runner.run(command(["open", "http://x"]));
check("a rejected spawn is a failure", never.ok === false);
check(
	"with the provider's reason",
	never.ok === false && never.error.includes("ENOENT"),
);

section("bounds on one call");
const stuck = runnerFor({ untilAborted: true });
const timedOut = await stuck.runner.run(
	command(["open", "http://x"], { timeoutMs: 20 }),
);
check("a command that never settles is stopped", timedOut.ok === false);
check(
	"and says it ran out of time",
	timedOut.ok === false && timedOut.error.includes("did not finish within"),
);

const cancelled = new AbortController();
cancelled.abort();
const abandoned = await runnerFor({ untilAborted: true }).runner.run(
	command(["open", "http://x"], { signal: cancelled.signal }),
);
check("a cancelled call is a failure", abandoned.ok === false);
check(
	"and is not reported as a timeout",
	abandoned.ok === false && abandoned.error === "the call was cancelled",
);

report();

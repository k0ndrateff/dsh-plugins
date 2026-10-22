/**
 * The plugin against a real browser, on a real page.
 *
 * The seam below really serves HTTP and really spawns processes, so this proves
 * the whole pipeline — the argument list, the session name, the CLI's own JSON,
 * the tools' projection of it — on live output rather than on fixtures. A machine
 * without the CLI, or without the Chrome it needs, skips itself loudly: the
 * offline suites are what must never fail.
 *
 *   bun run test/dry-run.ts
 */

import { execFileSync, spawn as spawnProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Context } from "@deepseek-ai/cordis";
import type {
	SubprocessHandle,
	SubprocessOutcome,
	SubprocessSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { resolveConfig } from "../src/host/config";
import { AgentBrowserRunner } from "../src/host/runner";
import { SessionScope } from "../src/host/session";
import { actTool } from "../src/host/tools/act";
import { openTool } from "../src/host/tools/open";
import { readTool } from "../src/host/tools/read";
import { runTool } from "../src/host/tools/run";
import { snapshotTool } from "../src/host/tools/snapshot";
import { check, report, section } from "./harness";

/** The page the browser is pointed at: a button, a heading, a log and a throw. */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8">
<title>dry-run fixture</title></head><body>
<button id="b" onclick="document.getElementById('h').textContent='clicked'">Poke me</button>
<h1 id="h">untouched</h1>
<script>
console.log('fixture ready');
setTimeout(() => { throw new Error('fixture: thrown on purpose'); }, 10);
</script></body></html>`;

/** Serve the fixture on a loopback port, and say how to stop. */
const serve = async (): Promise<{ url: string; close: () => void }> => {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(FIXTURE);
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address() as AddressInfo;

	return {
		url: `http://127.0.0.1:${address.port}/`,
		close: () => server.close(),
	};
};

/** The seam a real run goes through, really spawning. */
const realSubprocess = () => ({
	resolveExecutable: async (command: string): Promise<string> => {
		const path = execFileSync("which", [command], { encoding: "utf8" }).trim();

		if (path === "") throw new Error(`${command} is not on PATH`);

		return path;
	},
	spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
		const child = spawnProcess(spec.argv[0] as string, spec.argv.slice(1), {
			cwd: spec.cwd,
			env: { ...process.env, ...(spec.env ?? {}) },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		spec.signal?.addEventListener(
			"abort",
			() => {
				child.kill("SIGTERM");
			},
			{ once: true },
		);

		return {
			stdin: undefined,
			stdout: undefined,
			stderr: undefined,
			control: undefined,
			collected: {
				stdout: {
					readFrom: () => ({
						text: stdout,
						nextOffset: stdout.length,
						lossy: false,
					}),
				},
				stderr: {
					readFrom: () => ({
						text: stderr,
						nextOffset: stderr.length,
						lossy: false,
					}),
				},
			},
			done: new Promise<SubprocessOutcome>((resolve, reject) => {
				child.on("error", reject);
				child.on("close", (code) => resolve({ exitCode: code, signal: null }));
			}),
			terminate: () => {
				child.kill("SIGTERM");
			},
			waitForExit: async () => true,
		} as unknown as SubprocessHandle;
	},
});

const ctx = {
	subprocess: realSubprocess(),
	workingDirectory: { ensure: async () => process.cwd() },
} as unknown as Context;
const config = resolveConfig(undefined);
const runner = new AgentBrowserRunner({ ctx, config });
const deps = { runner, sessions: new SessionScope(ctx), config };
const exec = (): ToolRunContext =>
	({
		signal: new AbortController().signal,
		callId: "dry-run",
		agent: { session: { id: "dryrun" } },
		deferContext: () => {},
		concludeTurn: () => {},
	}) as unknown as ToolRunContext;

/** Run one tool and hand back its canonical value. */
const call = async (
	tool: ToolDefinition,
	args: unknown,
): Promise<Record<string, unknown>> =>
	(await tool.execute(args, exec())) as Record<string, unknown>;

section("is this machine able to run a browser?");
const status = await runner.status({
	session: "dsh-dryrun",
	cwd: process.cwd(),
	signal: new AbortController().signal,
});

if (status === undefined) {
	console.log("skipped: agent-browser is not installed");
	process.exit(0);
}

if (status.failing.some((line) => line.startsWith("chrome."))) {
	console.log(`skipped: ${status.failing.join("; ")}`);
	process.exit(0);
}

check("the CLI answers doctor", status.version !== undefined, status.version);
check(
	"Chrome is there",
	status.chrome !== undefined,
	status.chrome?.slice(0, 40),
);

section("a real page in a real browser");
const fixture = await serve();

try {
	const opened = await call(openTool.create(deps), { url: fixture.url });
	check("the page opened", opened.url === fixture.url, String(opened.url));
	check(
		"with its own title",
		String(opened.title).includes("dry-run"),
		String(opened.title),
	);

	const tree = await call(snapshotTool.create(deps), {});
	const snapshot = String(tree.snapshot);
	check("the tree names the button", snapshot.includes("Poke me"));
	check(
		"and counts what it handed out",
		Number(tree.elements) > 0,
		String(tree.elements),
	);

	const ref = /"Poke me" \[ref=(e\d+)\]/u.exec(snapshot)?.[1];
	check("with a reference to click", ref !== undefined, ref);

	const clicked = await call(actTool.create(deps), {
		action: "click",
		target: `@${ref ?? "e1"}`,
	});
	check("the click went through", clicked.action === "click");

	const heading = await call(runTool.create(deps), {
		args: ["get", "text", "#h"],
	});
	check(
		"and the page changed",
		String(heading.answer).includes("clicked"),
		String(heading.answer).slice(0, 60),
	);

	const logged = await call(readTool.create(deps), { what: "console" });
	check(
		"the console is read",
		Number(logged.count) > 0,
		String(logged.text).slice(0, 60),
	);

	const thrown = await call(readTool.create(deps), { what: "errors" });
	check(
		"the page's own error is read",
		Number(thrown.count) > 0,
		String(thrown.text).slice(0, 60),
	);
} catch (error) {
	check(
		"the live run finished",
		false,
		error instanceof Error ? error.message : String(error),
	);
} finally {
	fixture.close();
	await runner.run({
		args: ["close"],
		session: "dsh-dryrun",
		cwd: process.cwd(),
		signal: new AbortController().signal,
	});
}

report();

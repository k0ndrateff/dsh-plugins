/**
 * What each tool asks the browser for, and what it says back.
 *
 * The runner is scripted, so every case is about the tool's own decisions: which
 * CLI arguments a verb turns into, which of them are refused before anything
 * runs, how an answer is projected for the model, and when a reference is not
 * worth reading back.
 *
 *   bun run test/tools.ts
 */

import { expect, test } from "bun:test";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { BrowserSettings } from "../src/host/config";
import type {
	AgentBrowserRunner,
	BrowserCommand,
	BrowserOutcome,
} from "../src/host/runner";
import type { SessionScope } from "../src/host/session";
import type { StreamHubs } from "../src/host/stream/hubs";
import { actTool } from "../src/host/tools/act";
import type { BrowserToolDeps } from "../src/host/tools/deps";
import { withHumanNotice } from "../src/host/tools/notice";
import { openTool } from "../src/host/tools/open";
import { readTool } from "../src/host/tools/read";
import { runTool } from "../src/host/tools/run";
import { snapshotTool } from "../src/host/tools/snapshot";

/** An answer, or a function of the call that is being answered. */
type Script =
	| readonly BrowserOutcome[]
	| ((command: BrowserCommand) => BrowserOutcome);

/** A successful run with a payload. */
const ok = (data: unknown): BrowserOutcome => ({
	ok: true,
	data,
	durationMs: 1,
});

/** A runner that records what it was asked and answers from a script. */
const scriptedRunner = (script: Script) => {
	const commands: BrowserCommand[] = [];
	const runner = {
		run: async (command: BrowserCommand): Promise<BrowserOutcome> => {
			commands.push(command);

			return typeof script === "function"
				? script(command)
				: (script[commands.length - 1] ?? {
						ok: false,
						error: "no scripted answer",
						durationMs: 0,
					});
		},
		status: async () => undefined,
	} as unknown as AgentBrowserRunner;

	return { runner, commands };
};

/** The session scope every tool resolves before it runs. */
const scriptedScope = () => {
	const asked: unknown[] = [];
	const sessions = {
		of: async (agent: unknown) => {
			asked.push(agent);

			return { name: "dsh-test", cwd: "/tmp/project" };
		},
	} as unknown as SessionScope;

	return { sessions, asked };
};

/** The hubs the tools report a working browser to. */
const scriptedHubs = () => {
	const live: string[] = [];
	const closed: string[] = [];
	const hubs = {
		markLive: (session: string) => live.push(session),
		markClosed: (session: string) => closed.push(session),
	} as unknown as StreamHubs;

	return { hubs, live, closed };
};

/** One plugin's worth of tools over one script. */
const toolsFor = (script: Script, maxOutputBytes = 400) => {
	const { runner, commands } = scriptedRunner(script);
	const { sessions, asked } = scriptedScope();
	const { hubs, live, closed } = scriptedHubs();
	const deps: BrowserToolDeps = {
		runner,
		sessions,
		config: BrowserSettings.from({ maxOutputBytes }),
		hubs,
	};

	return {
		deps,
		commands,
		asked,
		live,
		closed,
		open: openTool.create(deps),
		snapshot: snapshotTool.create(deps),
		act: actTool.create(deps),
		read: readTool.create(deps),
		run: runTool.create(deps),
	};
};

/** One execution, as many as the tool needs to see. */
const execOf = (
	agent: unknown = undefined,
	signal = new AbortController().signal,
): ToolRunContext =>
	({
		signal,
		callId: "c1",
		agent,
		deferContext: () => {},
		concludeTurn: () => {},
	}) as unknown as ToolRunContext;

/** Run one tool and hand back its canonical value and the text the model reads. */
const call = async (
	tool: ToolDefinition,
	args: unknown,
	exec: ToolRunContext = execOf(),
): Promise<{ value: Record<string, unknown>; text: string }> => {
	const value = (await tool.execute(args, exec)) as Record<string, unknown>;
	const blocks = tool.output.render(args, value as never);

	return {
		value,
		text: blocks
			.map((block) => (block.type === "text" ? block.text : ""))
			.join(""),
	};
};

/** The reason one refused call gave, or the empty string when it did not. */
const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
	try {
		await run();

		return "";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

test("opening a page", async () => {
	const opened = toolsFor([
		ok({
			lifecycle: { browserLaunched: true },
			targetId: "5F2C",
			title: "Checkout",
			url: "http://x/checkout",
		}),
	]);
	const open = await call(
		opened.open,
		{ url: "http://x/checkout" },
		execOf({ sessionId: "s1" }),
	);

	expect(
		opened.commands[0]?.args.join(" ") === "open http://x/checkout",
		"the URL is the command's argument",
	).toBe(true);
	expect(
		open.value.url === "http://x/checkout",
		"the answer carries the final address",
	).toBe(true);
	expect(open.value.title === "Checkout", "and the page's own title").toBe(
		true,
	);
	expect(
		open.text.includes("Checkout") && open.text.includes("http://x/checkout"),
		"the model reads both",
	).toBe(true);
	expect(
		opened.asked[0] !== undefined,
		"the calling session is the one resolved",
	).toBe(true);
	expect(
		opened.commands[0]?.cwd === "/tmp/project",
		"the session's directory is used",
	).toBe(true);
	expect(opened.commands[0]?.session === "dsh-test", "and its name").toBe(true);
	expect(
		(await refusalOf(() => call(opened.open, {}))).includes("needs a url"),
		"a call without a URL is refused",
	).toBe(true);

	const unreachable = toolsFor([
		{ ok: false, error: "net::ERR_CONNECTION_REFUSED", durationMs: 1 },
	]);
	expect(
		(
			await refusalOf(() => call(unreachable.open, { url: "http://x" }))
		).includes("ERR_CONNECTION_REFUSED"),
		"a page that will not load fails the call",
	).toBe(true);
});
test("seeing the page", async () => {
	const seenTree = {
		origin: "http://x/",
		refs: {
			e1: { name: "Save", role: "button" },
			e2: { name: "Email", role: "textbox" },
		},
		snapshot: '- button "Save" [ref=e1]\n- textbox "Email" [ref=e2]',
	};
	const seen = toolsFor(() => ok(seenTree));
	const tree = await call(seen.snapshot, {});

	expect(
		seen.commands[0]?.args.join(" ") === "snapshot -i",
		"only interactive elements by default",
	).toBe(true);
	expect(
		tree.value.snapshot ===
			'- button "Save" [ref=e1]\n- textbox "Email" [ref=e2]',
		"the tree is the answer",
	).toBe(true);
	expect(tree.value.elements === 2, "with the references counted").toBe(true);
	expect(tree.value.url === "http://x/", "and the page named").toBe(true);
	expect(tree.text.includes("[ref=e1]"), "the model reads the references").toBe(
		true,
	);

	await call(seen.snapshot, { interactive: false, selector: "#main" });
	expect(
		seen.commands[1]?.args.join(" ") === "snapshot -s #main",
		"the whole tree of one part is what was asked",
	).toBe(true);

	const empty = toolsFor([ok({ origin: "http://x/", refs: {}, snapshot: "" })]);
	const nothing = await call(empty.snapshot, {});
	expect(nothing.value.elements === 0, "an empty tree is not an error").toBe(
		true,
	);
	expect(
		nothing.text.includes("no interactive elements"),
		"and the model is told what it means",
	).toBe(true);

	const dense = toolsFor(
		[
			ok({
				origin: "http://x/",
				snapshot: Array.from(
					{ length: 80 },
					(_, i) => `- link "row ${i}" [ref=e${i}]`,
				).join("\n"),
			}),
		],
		200,
	);
	const denseTree = await call(dense.snapshot, {});
	expect(
		String(denseTree.value.snapshot).includes(
			"the answer was cut at 200 bytes",
		),
		"a tree over the cap is cut",
	).toBe(true);
	expect(
		denseTree.value.elements === 80,
		"and the references are still counted",
	).toBe(true);
});
test("acting on the page", async () => {
	const clicked = toolsFor((command) =>
		command.args[0] === "get"
			? ok({ url: "http://x/next" })
			: ok({ clicked: "@e1", lifecycle: {} }),
	);
	const click = await call(clicked.act, { action: "click", target: "@e1" });

	expect(
		clicked.commands[0]?.args.join(" ") === "click @e1",
		"a click is one command",
	).toBe(true);
	expect(
		String(click.value.target) === "@e1",
		"the reference is quoted back",
	).toBe(true);
	expect(
		clicked.commands[1]?.args.join(" ") === "get url",
		"the address is read after it",
	).toBe(true);
	expect(
		click.value.url === "http://x/next",
		"and the page is reported as moved",
	).toBe(true);
	expect(click.text.includes("Clicked"), "the model reads what happened").toBe(
		true,
	);

	const typed = toolsFor([ok({ filled: "@e2" })]);
	await call(typed.act, {
		action: "fill",
		target: "@e2",
		value: "ada@example.com",
	});
	expect(
		typed.commands[0]?.args.join(" ") === "fill @e2 ada@example.com",
		"typing passes the text as one argument",
	).toBe(true);
	expect(
		(
			await refusalOf(() => call(typed.act, { action: "fill", target: "@e2" }))
		).includes("needs a value"),
		"typing without a value is refused",
	).toBe(true);

	const chosen = toolsFor([ok({ selected: "@e3" })]);
	await call(chosen.act, { action: "select", target: "@e3", value: "eu west" });
	expect(
		chosen.commands[0]?.args.join("|") === "select|@e3|eu|west",
		"a multi-word option becomes one argument each",
	).toBe(true);

	const scrolled = toolsFor([ok({ scrolled: "down" })]);
	await call(scrolled.act, { action: "scroll", target: "down", value: "400" });
	expect(
		scrolled.commands[0]?.args.join(" ") === "scroll down 400",
		"scrolling passes how far",
	).toBe(true);
	expect(scrolled.commands.length === 1, "and reads no address").toBe(true);

	const hovered = toolsFor([ok({ hovered: "@e4" })]);
	await call(hovered.act, { action: "hover", target: "@e4" });
	expect(hovered.commands.length === 1, "hovering is one command").toBe(true);
	expect(
		hovered.commands[0]?.args.join(" ") === "hover @e4",
		"and reads no address",
	).toBe(true);

	expect(
		(
			await refusalOf(() =>
				call(hovered.act, { action: "submit", target: "@e1" }),
			)
		).includes("click, fill, press, select, hover, scroll, wait"),
		"an unknown verb is refused before anything runs",
	).toBe(true);
	expect(
		(await refusalOf(() => call(hovered.act, { action: "click" }))).includes(
			"needs a target",
		),
		"a missing target is refused",
	).toBe(true);
	expect(
		(
			await refusalOf(() =>
				call(
					toolsFor([
						{ ok: false, error: "no element matches @e9", durationMs: 1 },
					]).act,
					{ action: "click", target: "@e9" },
				),
			)
		).includes("no element matches"),
		"a page that refuses the click fails the call",
	).toBe(true);
});
test("reading the page", async () => {
	const text = toolsFor([
		ok({ content: "Checkout\n\n# Pay now", contentType: "text/html" }),
	]);
	const page = await call(text.read, {});
	expect(
		text.commands[0]?.args.join(" ") === "read",
		"the page text is one command",
	).toBe(true);
	expect(page.value.count === 3, "every line is kept").toBe(true);
	expect(page.text.includes("Pay now"), "and the model reads them").toBe(true);

	const console_ = toolsFor(() =>
		ok({
			messages: [
				{ args: [], text: "ready", type: "log" },
				{ args: [], text: "failed to load", type: "error" },
			],
		}),
	);
	const logged = await call(console_.read, { what: "console" });
	expect(
		console_.commands[0]?.args.join(" ") === "console",
		"the console is one command",
	).toBe(true);
	expect(logged.value.count === 2, "every message is kept").toBe(true);
	expect(logged.text.includes("error: failed to load"), "with its level").toBe(
		true,
	);

	await call(console_.read, { what: "console", clear: true });
	expect(
		console_.commands[1]?.args.join(" ") === "console --clear",
		"clearing is passed through",
	).toBe(true);

	const errors = toolsFor([
		ok({ errors: [{ column: 23, line: 5, text: "Error: boom", url: null }] }),
	]);
	const thrown = await call(errors.read, { what: "errors" });
	expect(
		errors.commands[0]?.args.join(" ") === "errors",
		"the error log is one command",
	).toBe(true);
	expect(
		thrown.text.includes("Error: boom"),
		"and the page's own error is kept",
	).toBe(true);

	const quiet = toolsFor([ok({ messages: [] })]);
	const silent = await call(quiet.read, { what: "console" });
	expect(silent.value.count === 0, "an empty log is not an error").toBe(true);
	expect(
		silent.text.includes("console is empty"),
		"and the model is told which log is empty",
	).toBe(true);

	expect(
		(await refusalOf(() => call(quiet.read, { what: "network" }))).includes(
			"text, console, errors",
		),
		"an unknown log is refused",
	).toBe(true);
});
test("the escape hatch", async () => {
	const escaped = toolsFor(() => ok({ requests: [{ url: "http://x/api" }] }));
	const ran = await call(escaped.run, { args: ["network", "requests"] });
	expect(
		escaped.commands[0]?.args.join(" ") === "network requests",
		"the command is passed as it came",
	).toBe(true);
	expect(ran.text.includes("http://x/api"), "its answer is JSON text").toBe(
		true,
	);

	await call(escaped.run, { args: ["agent-browser", "tab", "list"] });
	expect(
		escaped.commands[1]?.args.join(" ") === "tab list",
		"a command that names the executable has it dropped",
	).toBe(true);

	expect(
		(await refusalOf(() => call(escaped.run, { args: [] }))).includes(
			"needs a command",
		),
		"an empty command is refused",
	).toBe(true);
	expect(
		(await refusalOf(() => call(escaped.run, { args: [1, 2] }))).includes(
			"array of strings",
		),
		"a command of things that are not strings is refused",
	).toBe(true);
	expect(
		(
			await refusalOf(() =>
				call(escaped.run, {
					args: ["--session", "someone-else", "open", "http://x/"],
				}),
			)
		).includes("pinned to this conversation"),
		"a session override is refused",
	).toBe(true);
	expect(
		(
			await refusalOf(() => call(escaped.run, { args: ["close", "--all"] }))
		).includes("not every session"),
		"closing every session is refused",
	).toBe(true);
});
test("what the person did while the agent was away", async () => {
	const notingHubs = (note: string | undefined) => {
		const taken: string[] = [];
		const hubs = {
			takeNote: (session: string) => {
				taken.push(session);

				return note;
			},
		} as unknown as StreamHubs;

		return { hubs, taken };
	};

	const result = (text: string) => ({
		isError: false as const,
		value: {},
		content: [{ type: "text" as const, text }],
	});

	const plain = snapshotTool.create(
		toolsFor([{ ok: true, data: {}, durationMs: 0 }]).deps,
	);
	const quietNotice = withHumanNotice(plain, notingHubs(undefined).hubs);
	expect(
		quietNotice.finalizeContent?.(
			execOf({ session: { id: "session-9" } }),
			result("tree"),
		) === undefined,
		"a person who did nothing adds nothing",
	).toBe(true);

	const { hubs: telling, taken } = notingHubs(
		"The person at the panel used this browser: clicked at (4, 5).",
	);
	const noticed = withHumanNotice(plain, telling);
	const blocks = noticed.finalizeContent?.(
		execOf({ session: { id: "session-9" } }),
		result("tree"),
	);
	expect(
		blocks?.[0]?.type === "text" &&
			String(blocks[0].text).startsWith("The person at the panel"),
		"a person's act leads the result",
	).toBe(true);
	expect(
		blocks?.[1]?.type === "text",
		"with the tool's own answer after it",
	).toBe(true);
	expect(
		taken[0] === "dsh-session-9",
		"and the note is asked for the session that called",
	).toBe(true);
	expect(
		plain.finalizeContent === undefined && plain.name === noticed.name,
		"the tool itself is left as it was",
	).toBe(true);
});

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

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { resolveConfig } from "../src/host/config";
import type {
	AgentBrowserRunner,
	BrowserCommand,
	BrowserOutcome,
} from "../src/host/runner";
import type { SessionScope } from "../src/host/session";
import { actTool } from "../src/host/tools/act";
import type { BrowserToolDeps } from "../src/host/tools/deps";
import { openTool } from "../src/host/tools/open";
import { readTool } from "../src/host/tools/read";
import { runTool } from "../src/host/tools/run";
import { snapshotTool } from "../src/host/tools/snapshot";
import { check, report, section } from "./harness";

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

/** One plugin's worth of tools over one script. */
const toolsFor = (script: Script, maxOutputBytes = 400) => {
	const { runner, commands } = scriptedRunner(script);
	const { sessions, asked } = scriptedScope();
	const deps: BrowserToolDeps = {
		runner,
		sessions,
		config: resolveConfig({ maxOutputBytes }),
	};

	return {
		deps,
		commands,
		asked,
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

section("opening a page");
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

check(
	"the URL is the command's argument",
	opened.commands[0]?.args.join(" ") === "open http://x/checkout",
);
check(
	"the answer carries the final address",
	open.value.url === "http://x/checkout",
);
check("and the page's own title", open.value.title === "Checkout");
check(
	"the model reads both",
	open.text.includes("Checkout") && open.text.includes("http://x/checkout"),
);
check("the calling session is the one resolved", opened.asked[0] !== undefined);
check(
	"the session's directory is used",
	opened.commands[0]?.cwd === "/tmp/project",
);
check("and its name", opened.commands[0]?.session === "dsh-test");
check(
	"a call without a URL is refused",
	(await refusalOf(() => call(opened.open, {}))).includes("needs a url"),
);

const unreachable = toolsFor([
	{ ok: false, error: "net::ERR_CONNECTION_REFUSED", durationMs: 1 },
]);
check(
	"a page that will not load fails the call",
	(await refusalOf(() => call(unreachable.open, { url: "http://x" }))).includes(
		"ERR_CONNECTION_REFUSED",
	),
);

section("seeing the page");
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

check(
	"only interactive elements by default",
	seen.commands[0]?.args.join(" ") === "snapshot -i",
);
check(
	"the tree is the answer",
	tree.value.snapshot ===
		'- button "Save" [ref=e1]\n- textbox "Email" [ref=e2]',
);
check("with the references counted", tree.value.elements === 2);
check("and the page named", tree.value.url === "http://x/");
check("the model reads the references", tree.text.includes("[ref=e1]"));

await call(seen.snapshot, { interactive: false, selector: "#main" });
check(
	"the whole tree of one part is what was asked",
	seen.commands[1]?.args.join(" ") === "snapshot -s #main",
);

const empty = toolsFor([ok({ origin: "http://x/", refs: {}, snapshot: "" })]);
const nothing = await call(empty.snapshot, {});
check("an empty tree is not an error", nothing.value.elements === 0);
check(
	"and the model is told what it means",
	nothing.text.includes("no interactive elements"),
);

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
check(
	"a tree over the cap is cut",
	String(denseTree.value.snapshot).includes("the answer was cut at 200 bytes"),
);
check("and the references are still counted", denseTree.value.elements === 80);

section("acting on the page");
const clicked = toolsFor((command) =>
	command.args[0] === "get"
		? ok({ url: "http://x/next" })
		: ok({ clicked: "@e1", lifecycle: {} }),
);
const click = await call(clicked.act, { action: "click", target: "@e1" });

check(
	"a click is one command",
	clicked.commands[0]?.args.join(" ") === "click @e1",
);
check("the reference is quoted back", String(click.value.target) === "@e1");
check(
	"the address is read after it",
	clicked.commands[1]?.args.join(" ") === "get url",
);
check("and the page is reported as moved", click.value.url === "http://x/next");
check("the model reads what happened", click.text.includes("Clicked"));

const typed = toolsFor([ok({ filled: "@e2" })]);
await call(typed.act, {
	action: "fill",
	target: "@e2",
	value: "ada@example.com",
});
check(
	"typing passes the text as one argument",
	typed.commands[0]?.args.join(" ") === "fill @e2 ada@example.com",
);
check(
	"typing without a value is refused",
	(
		await refusalOf(() => call(typed.act, { action: "fill", target: "@e2" }))
	).includes("needs a value"),
);

const chosen = toolsFor([ok({ selected: "@e3" })]);
await call(chosen.act, { action: "select", target: "@e3", value: "eu west" });
check(
	"a multi-word option becomes one argument each",
	chosen.commands[0]?.args.join("|") === "select|@e3|eu|west",
);

const scrolled = toolsFor([ok({ scrolled: "down" })]);
await call(scrolled.act, { action: "scroll", target: "down", value: "400" });
check(
	"scrolling passes how far",
	scrolled.commands[0]?.args.join(" ") === "scroll down 400",
);
check("and reads no address", scrolled.commands.length === 1);

const hovered = toolsFor([ok({ hovered: "@e4" })]);
await call(hovered.act, { action: "hover", target: "@e4" });
check("hovering is one command", hovered.commands.length === 1);
check(
	"and reads no address",
	hovered.commands[0]?.args.join(" ") === "hover @e4",
);

check(
	"an unknown verb is refused before anything runs",
	(
		await refusalOf(() =>
			call(hovered.act, { action: "submit", target: "@e1" }),
		)
	).includes("click, fill, press, select, hover, scroll, wait"),
);
check(
	"a missing target is refused",
	(await refusalOf(() => call(hovered.act, { action: "click" }))).includes(
		"needs a target",
	),
);
check(
	"a page that refuses the click fails the call",
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
);

section("reading the page");
const text = toolsFor([
	ok({ content: "Checkout\n\n# Pay now", contentType: "text/html" }),
]);
const page = await call(text.read, {});
check(
	"the page text is one command",
	text.commands[0]?.args.join(" ") === "read",
);
check("every line is kept", page.value.count === 3);
check("and the model reads them", page.text.includes("Pay now"));

const console_ = toolsFor(() =>
	ok({
		messages: [
			{ args: [], text: "ready", type: "log" },
			{ args: [], text: "failed to load", type: "error" },
		],
	}),
);
const logged = await call(console_.read, { what: "console" });
check(
	"the console is one command",
	console_.commands[0]?.args.join(" ") === "console",
);
check("every message is kept", logged.value.count === 2);
check("with its level", logged.text.includes("error: failed to load"));

await call(console_.read, { what: "console", clear: true });
check(
	"clearing is passed through",
	console_.commands[1]?.args.join(" ") === "console --clear",
);

const errors = toolsFor([
	ok({ errors: [{ column: 23, line: 5, text: "Error: boom", url: null }] }),
]);
const thrown = await call(errors.read, { what: "errors" });
check(
	"the error log is one command",
	errors.commands[0]?.args.join(" ") === "errors",
);
check("and the page's own error is kept", thrown.text.includes("Error: boom"));

const quiet = toolsFor([ok({ messages: [] })]);
const silent = await call(quiet.read, { what: "console" });
check("an empty log is not an error", silent.value.count === 0);
check(
	"and the model is told which log is empty",
	silent.text.includes("console is empty"),
);

check(
	"an unknown log is refused",
	(await refusalOf(() => call(quiet.read, { what: "network" }))).includes(
		"text, console, errors",
	),
);

section("the escape hatch");
const escaped = toolsFor(() => ok({ requests: [{ url: "http://x/api" }] }));
const ran = await call(escaped.run, { args: ["network", "requests"] });
check(
	"the command is passed as it came",
	escaped.commands[0]?.args.join(" ") === "network requests",
);
check("its answer is JSON text", ran.text.includes("http://x/api"));

await call(escaped.run, { args: ["agent-browser", "tab", "list"] });
check(
	"a command that names the executable has it dropped",
	escaped.commands[1]?.args.join(" ") === "tab list",
);

check(
	"an empty command is refused",
	(await refusalOf(() => call(escaped.run, { args: [] }))).includes(
		"needs a command",
	),
);
check(
	"a command of things that are not strings is refused",
	(await refusalOf(() => call(escaped.run, { args: [1, 2] }))).includes(
		"array of strings",
	),
);

report();

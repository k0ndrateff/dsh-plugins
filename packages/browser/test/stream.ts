/**
 * The live view: what one screencast message means, and what one hub does with
 * it.
 *
 * The screencast is scripted — a port the test decides, a peer the test holds —
 * so the cases that matter are all reachable without a browser: a session with no
 * browser at all, a connection that drops, a reader that leaves, and the rule
 * that opening a panel never starts a browser on its own.
 *
 *   bun run test/stream.ts
 */

import {
	commandText,
	parseStreamMessage,
	resultText,
} from "../src/host/stream/events";
import { parseStreamStatus } from "../src/host/stream/facts";
import { StreamHub } from "../src/host/stream/hub";
import type { WirePeer } from "../src/host/wire/peer";
import type { PanelMessage } from "../src/shared/panel";
import { check, report, section } from "./harness";

/** One message the hub would send a panel. */
const messageOf = (type: string, text: string): string =>
	JSON.stringify(
		type === "frame" ? { type, seq: 1, data: text } : JSON.parse(text),
	);

const tick = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

section("what the CLI says about a screencast");
check(
	"a port is read",
	parseStreamStatus({ port: 9335, connected: false })?.port === 9335,
);
check(
	"with what it is doing",
	parseStreamStatus({ port: 9335, screencasting: true })?.screencasting ===
		true,
);
check(
	"no port means no stream",
	parseStreamStatus({ connected: false }) === undefined,
);
check(
	"and nonsense means none either",
	parseStreamStatus("ws://…") === undefined,
);

section("what one screencast message means");
const frame = parseStreamMessage(
	JSON.stringify({
		type: "frame",
		seq: 7,
		data: "abc",
		metadata: { deviceWidth: 1280, deviceHeight: 720 },
	}),
);
check("a frame carries its picture", frame?.kind === "frame");
check("its sequence", frame?.kind === "frame" && frame.frame.seq === 7);
check(
	"and the viewport it was taken in",
	frame?.kind === "frame" && frame.frame.width === 1280,
);

const tabs = parseStreamMessage(
	JSON.stringify({
		type: "tabs",
		tabs: [
			{ active: false, url: "http://other/", title: "other" },
			{ active: true, url: "http://x/", title: "X" },
		],
	}),
);
check(
	"the active tab is the address",
	tabs?.kind === "address" && tabs.url === "http://x/",
);
check("with its title", tabs?.kind === "address" && tabs.title === "X");

const bare = parseStreamMessage(
	JSON.stringify({ type: "url", url: "http://y/" }),
);
check(
	"a bare url is an address too",
	bare?.kind === "address" && bare.url === "http://y/",
);

const command = parseStreamMessage(
	JSON.stringify({
		type: "command",
		id: "r1",
		action: "click",
		params: { id: "r1", action: "click", selector: "@e2" },
		timestamp: 5,
	}),
);
check("a command is an activity line", command?.kind === "activity");
check(
	"naming what was done to what",
	command?.kind === "activity" && command.activity.text === "click @e2",
);
check(
	"and which half of a pair it is",
	command?.kind === "activity" && command.activity.kind === "command",
);

const outcome = parseStreamMessage(
	JSON.stringify({
		type: "result",
		id: "r1",
		action: "click",
		duration_ms: 10,
	}),
);
check(
	"an outcome carries its duration",
	outcome?.kind === "activity" && outcome.activity.text === "10ms",
);
check(
	"and is the other half",
	outcome?.kind === "activity" && outcome.activity.kind === "result",
);

check(
	"the CLI attaching itself is dropped",
	parseStreamMessage(
		JSON.stringify({ type: "command", id: "r0", action: "launch", params: {} }),
	) === undefined,
);
check(
	"and so is the screencast's own health",
	parseStreamMessage(JSON.stringify({ type: "status", connected: true })) ===
		undefined,
);
check("not JSON is nothing", parseStreamMessage("<html>") === undefined);
check(
	"a frame without a picture is nothing",
	parseStreamMessage(JSON.stringify({ type: "frame", seq: 1 })) === undefined,
);
check(
	"a command with no detail is its action",
	commandText("console", { id: "r2" }) === "console",
);
check(
	"a wordless action still reads",
	commandText("snapshot", undefined) === "snapshot",
);
check("a missing duration reads as done", resultText(undefined) === "done");

section("one hub, one screencast");

/** This session's screencast, as the test decides it. */
const scenario = (port: number | undefined) => {
	const seen: PanelMessage[] = [];
	const sent: string[] = [];
	let handlers:
		| { onMessage: (text: string) => void; onClose: (reason: string) => void }
		| undefined;
	let connections = 0;
	let closed = false;

	const peer = {
		send: (text: string) => sent.push(text),
		close: () => {
			closed = true;
		},
	} as unknown as WirePeer;

	const hub = new StreamHub({
		session: "dsh-test",
		port: async () => port,
		connect: async (_port, given) => {
			connections += 1;
			handlers = given;

			return peer;
		},
		idleMs: 10,
	});

	return {
		hub,
		seen,
		sent,
		connections: () => connections,
		closed: () => closed,
		handlers: () => handlers,
		frame: (text: string) => handlers?.onMessage(messageOf("frame", text)),
		feed: (message: unknown) => handlers?.onMessage(JSON.stringify(message)),
	};
};

const quiet = scenario(undefined);
const stopQuiet = quiet.hub.watch((message) => quiet.seen.push(message));
check("a panel can watch before any browser exists", quiet.seen.length === 1);
check("and is told there is nothing yet", quiet.seen[0]?.type === "state");
check(
	"with a reason a person can act on",
	quiet.seen[0]?.type === "state" &&
		String(quiet.seen[0].error).includes("no browser"),
);
check("without the CLI being asked", quiet.connections() === 0);
stopQuiet();

const running = scenario(4242);
const stopRunning = running.hub.watch((message) => running.seen.push(message));
check(
	"watching alone still does not start a browser",
	running.connections() === 0,
);

running.hub.markLive();
await tick();
check("a tool call is what makes it connect", running.connections() === 1);
check(
	"and the screencast is asked for a bounded frame rate",
	running.sent[0]?.includes('"maxFps"') === true,
);
check(
	"which is state the reader sees",
	running.seen.some(
		(message) => message.type === "state" && message.connected === true,
	),
);

running.feed({
	type: "tabs",
	tabs: [{ active: true, url: "http://x/", title: "X" }],
});
const addressed = running.seen
	.filter((message) => message.type === "state")
	.at(-1);
check(
	"the address reaches the reader",
	addressed?.type === "state" && addressed.url === "http://x/",
);
check(
	"with the page's title",
	addressed?.type === "state" && addressed.title === "X",
);

running.frame("jpegbytes");
check(
	"a frame reaches the reader",
	running.seen.some(
		(message) => message.type === "frame" && message.data === "jpegbytes",
	),
);

running.feed({
	type: "command",
	id: "r1",
	action: "click",
	params: { selector: "@e2" },
	timestamp: 5,
});
running.feed({ type: "result", id: "r1", action: "click", duration_ms: 10 });
running.feed({ type: "command", id: "r2", action: "launch", params: {} });
const feed = running.seen
	.filter((message) => message.type === "activity")
	.at(-1);
check(
	"the feed is a window, not an append",
	feed?.type === "activity" && feed.items.length === 2,
);
check(
	"the command leads",
	feed?.type === "activity" && feed.items[0]?.text === "click @e2",
);
check(
	"and its outcome follows",
	feed?.type === "activity" && feed.items[1]?.text === "10ms",
);
check(
	"while the CLI's own attach is left out",
	feed?.type === "activity" &&
		feed.items.every((item) => !item.text.includes("launch")),
);

const latecomer: PanelMessage[] = [];
const stopLate = running.hub.watch((message) => latecomer.push(message));
check(
	"a reader that arrives late is told the state",
	latecomer[0]?.type === "state",
);
check(
	"and shown the last frame at once",
	latecomer.some((message) => message.type === "frame"),
);
check(
	"and the feed so far",
	latecomer.some((message) => message.type === "activity"),
);
stopLate();

running.handlers()?.onClose("the browser went away");
const lost = running.seen.filter((message) => message.type === "state").at(-1);
check("a dropped screencast is state the reader sees", lost?.type === "state");
check("as not connected", lost?.type === "state" && lost.connected === false);
check(
	"with the reason it dropped",
	lost?.type === "state" && lost.error === "the browser went away",
);
check(
	"and the stale picture is gone",
	!running.seen
		.slice(running.seen.indexOf(lost as PanelMessage))
		.some((message) => message.type === "frame"),
);
stopRunning();
running.hub.stop();

const closing = scenario(4243);
const stopClosing = closing.hub.watch((message) => closing.seen.push(message));
closing.hub.markLive();
await tick();
closing.hub.markClosed();
const shutdown = closing.seen
	.filter((message) => message.type === "state")
	.at(-1);
check(
	"a browser closed on purpose says so",
	shutdown?.type === "state" && String(shutdown.error).includes("closed"),
);
check("and is not looked for again", closing.connections() === 1);
stopClosing();
closing.hub.stop();

const leaving = scenario(4244);
const stopLeaving = leaving.hub.watch((message) => leaving.seen.push(message));
leaving.hub.markLive();
await tick();
check("the peer is open while somebody watches", leaving.closed() === false);
stopLeaving();
await new Promise((resolve) => setTimeout(resolve, 40));
check(
	"and is dropped a while after the last reader leaves",
	leaving.closed() === true,
);
leaving.hub.stop();

const unknown = scenario(undefined);
unknown.hub.markLive();
const stopUnknown = unknown.hub.watch((message) => unknown.seen.push(message));
await tick();
await tick();
const missing = unknown.seen
	.filter((message) => message.type === "state")
	.at(-1);
check(
	"a session whose browser is not running is told apart from one never opened",
	missing?.type === "state" &&
		String(missing.error).includes("no browser is running"),
);
check("and no connection was attempted", unknown.connections() === 0);
stopUnknown();
unknown.hub.stop();

report();

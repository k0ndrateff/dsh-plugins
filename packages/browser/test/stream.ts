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
import { check, report, section } from "./harness";

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
		sent,
		connections: () => connections,
		closed: () => closed,
		frame: (data: string) =>
			handlers?.onMessage(
				JSON.stringify({
					type: "frame",
					seq: 7,
					data,
					metadata: { deviceWidth: 1280, deviceHeight: 720 },
				}),
			),
		feed: (message: unknown) => handlers?.onMessage(JSON.stringify(message)),
		drop: (reason: string) => handlers?.onClose(reason),
	};
};

const quiet = scenario(undefined);
quiet.hub.touch();
const quietAnswer = quiet.hub.snapshot();
check(
	"a panel may ask before any browser exists",
	quietAnswer.connected === false,
);
check(
	"and is told there is nothing yet",
	String(quietAnswer.error).includes("no browser"),
);
check("without the CLI being asked", quiet.connections() === 0);
quiet.hub.stop();

const running = scenario(4242);
running.hub.touch();
check(
	"asking alone still does not start a browser",
	running.connections() === 0,
);

running.hub.markLive();
running.hub.touch();
await tick();
check("a tool call plus a poll is what connects", running.connections() === 1);
check(
	"and the screencast is asked for a bounded frame rate",
	running.sent[0]?.includes('"maxFps"') === true,
);
check("which the answer says", running.hub.snapshot().connected === true);

running.feed({
	type: "tabs",
	tabs: [{ active: true, url: "http://x/", title: "X" }],
});
const addressed = running.hub.snapshot();
check("the address reaches the reader", addressed.url === "http://x/");
check("with the page's title", addressed.title === "X");

running.frame("jpegbytes");
check(
	"a frame is kept for the picture route",
	running.hub.latestFrame()?.data === "jpegbytes",
);
check(
	"and its sequence is what a reader keys on",
	running.hub.snapshot().seq === 7,
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
const feed = running.hub.snapshot().activity;
check("the feed is a window, not an append", feed.length === 2);
check("the command leads", feed[0]?.text === "click @e2");
check("and its outcome follows", feed[1]?.text === "10ms");
check(
	"while the CLI's own attach is left out",
	feed.every((item) => !item.text.includes("launch")),
);

check(
	"the page's own size is what a click is measured against",
	running.hub.snapshot().viewport.width === 1280 &&
		running.hub.snapshot().viewport.height === 720,
);

const clicked = running.hub.sendInput({
	type: "mouse",
	event: "click",
	x: 10,
	y: 20,
	button: "left",
	modifiers: { alt: false, ctrl: false, meta: false, shift: false },
});
check("a person's click goes down the open connection", clicked === true);
check(
	"as the press and the release the page expects",
	running.sent.some((text) => text.includes("mousePressed")) &&
		running.sent.some((text) => text.includes("mouseReleased")),
);
check(
	"and is the person's own line in the feed",
	running.hub
		.snapshot()
		.activity.some(
			(item) => item.kind === "human" && item.text === "click 10×20",
		),
);

running.drop("the browser went away");
const lost = running.hub.snapshot();
check(
	"a dropped screencast is answered as not connected",
	lost.connected === false,
);
check("with the reason it dropped", lost.error === "the browser went away");
check(
	"and the stale picture is gone",
	running.hub.latestFrame() === undefined && lost.seq === 0,
);
check(
	"a click with nothing to carry it is refused",
	running.hub.sendInput({
		type: "wheel",
		x: 1,
		y: 2,
		deltaX: 0,
		deltaY: 10,
	}) === false,
);
running.hub.stop();

const closing = scenario(4243);
closing.hub.markLive();
closing.hub.touch();
await tick();
closing.hub.markClosed();
const shutdown = closing.hub.snapshot();
check(
	"a browser closed on purpose says so",
	String(shutdown.error).includes("closed"),
);
check("and is not looked for again", closing.connections() === 1);
closing.hub.stop();

const leaving = scenario(4244);
leaving.hub.markLive();
leaving.hub.touch();
await tick();
check("the connection is open while somebody asks", leaving.closed() === false);
await new Promise((resolve) => setTimeout(resolve, 40));
check("and is dropped a while after the last poll", leaving.closed() === true);
leaving.hub.stop();

const unknown = scenario(undefined);
unknown.hub.markLive();
unknown.hub.touch();
await tick();
await tick();
const missing = unknown.hub.snapshot();
check(
	"a session whose browser is not running is told apart from one never opened",
	String(missing.error).includes("no browser is running"),
);
check("and no connection was attempted", unknown.connections() === 0);
unknown.hub.stop();

report();

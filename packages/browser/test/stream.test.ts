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

import { expect, test } from "bun:test";
import {
	commandText,
	parseStreamMessage,
	resultText,
} from "../src/host/stream/events";
import { parseStreamStatus } from "../src/host/stream/facts";
import { StreamHub } from "../src/host/stream/hub";
import { PAGE_SIZE_SCRIPT, parsePageSize } from "../src/host/stream/page";
import type { WirePeer } from "../src/host/wire/peer";

const tick = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

test("what the CLI says about a screencast", async () => {
	expect(
		parseStreamStatus({ port: 9335, connected: false })?.port === 9335,
		"a port is read",
	).toBe(true);
	expect(
		parseStreamStatus({ port: 9335, screencasting: true })?.screencasting ===
			true,
		"with what it is doing",
	).toBe(true);
	expect(
		parseStreamStatus({ connected: false }) === undefined,
		"no port means no stream",
	).toBe(true);
	expect(
		parseStreamStatus("ws://…") === undefined,
		"and nonsense means none either",
	).toBe(true);
});
test("what the page says about itself", async () => {
	expect(
		parsePageSize({ result: "[1280,633]" })?.height === 633,
		"a pair is the page's size",
	).toBe(true);
	expect(
		parsePageSize({ result: "[1280,633]" })?.width === 1280,
		"and its width is the other half",
	).toBe(true);
	expect(
		parsePageSize({ result: "[0,633]" }) === undefined,
		"a page that could not be measured is nothing",
	).toBe(true);
	expect(
		parsePageSize({ result: "undefined" }) === undefined,
		"and so is a script that answered something else",
	).toBe(true);
	expect(
		parsePageSize({ result: "{}" }) === undefined,
		"or an answer that is not a pair",
	).toBe(true);
});
test("what one screencast message means", async () => {
	const frame = parseStreamMessage(
		JSON.stringify({
			type: "frame",
			seq: 7,
			data: "abc",
			metadata: { deviceWidth: 1280, deviceHeight: 720 },
		}),
	);
	expect(frame?.kind === "frame", "a frame carries its picture").toBe(true);
	expect(frame?.kind === "frame" && frame.frame.seq === 7, "its sequence").toBe(
		true,
	);
	expect(
		frame?.kind === "frame" && frame.frame.width === 1280,
		"and the viewport it was taken in",
	).toBe(true);

	const tabs = parseStreamMessage(
		JSON.stringify({
			type: "tabs",
			tabs: [
				{ active: false, url: "http://other/", title: "other" },
				{ active: true, url: "http://x/", title: "X" },
			],
		}),
	);
	expect(
		tabs?.kind === "address" && tabs.url === "http://x/",
		"the active tab is the address",
	).toBe(true);
	expect(tabs?.kind === "address" && tabs.title === "X", "with its title").toBe(
		true,
	);
	expect(
		tabs?.kind === "address" && tabs.tabs.length === 2,
		"and the tabs it reports, not only the active one",
	).toBe(true);
	expect(
		tabs?.kind === "address" && tabs.tabs[1]?.active === true,
		"with the active one marked",
	).toBe(true);

	const bare = parseStreamMessage(
		JSON.stringify({ type: "url", url: "http://y/" }),
	);
	expect(
		bare?.kind === "address" && bare.url === "http://y/",
		"a bare url is an address too",
	).toBe(true);

	const command = parseStreamMessage(
		JSON.stringify({
			type: "command",
			id: "r1",
			action: "click",
			params: { id: "r1", action: "click", selector: "@e2" },
			timestamp: 5,
		}),
	);
	expect(command?.kind === "activity", "a command is an activity line").toBe(
		true,
	);
	expect(
		command?.kind === "activity" && command.activity.text === "click @e2",
		"naming what was done to what",
	).toBe(true);
	expect(
		command?.kind === "activity" && command.activity.kind === "command",
		"and which half of a pair it is",
	).toBe(true);

	const outcome = parseStreamMessage(
		JSON.stringify({
			type: "result",
			id: "r1",
			action: "click",
			duration_ms: 10,
		}),
	);
	expect(
		outcome?.kind === "activity" && outcome.activity.text === "10ms",
		"an outcome carries its duration",
	).toBe(true);
	expect(
		outcome?.kind === "activity" && outcome.activity.kind === "result",
		"and is the other half",
	).toBe(true);

	expect(
		parseStreamMessage(
			JSON.stringify({
				type: "command",
				id: "p1",
				action: "evaluate",
				params: { script: PAGE_SIZE_SCRIPT },
			}),
		) === undefined,
		"the page-size probe is not the agent's work",
	).toBe(true);
	expect(
		parseStreamMessage(
			JSON.stringify({
				type: "command",
				id: "p2",
				action: "evaluate",
				params: { script: "document.title" },
			}),
		)?.kind === "activity",
		"while the agent's own evaluate is still worth a line",
	).toBe(true);
	expect(
		parseStreamMessage(
			JSON.stringify({
				type: "command",
				id: "r0",
				action: "launch",
				params: {},
			}),
		) === undefined,
		"the CLI attaching itself is dropped",
	).toBe(true);
	expect(
		parseStreamMessage(JSON.stringify({ type: "status", connected: true })) ===
			undefined,
		"and so is the screencast's own health",
	).toBe(true);
	expect(
		parseStreamMessage("<html>") === undefined,
		"not JSON is nothing",
	).toBe(true);
	expect(
		parseStreamMessage(JSON.stringify({ type: "frame", seq: 1 })) === undefined,
		"a frame without a picture is nothing",
	).toBe(true);
	expect(
		commandText("console", { id: "r2" }) === "console",
		"a command with no detail is its action",
	).toBe(true);
	expect(
		commandText("snapshot", undefined) === "snapshot",
		"a wordless action still reads",
	).toBe(true);
	expect(
		resultText(undefined) === "done",
		"a missing duration reads as done",
	).toBe(true);
});
test("one hub, one screencast", async () => {
	/** This session's screencast, as the test decides it. */
	const scenario = (
		port: number | undefined,
		pageSize:
			| { readonly width: number; readonly height: number }
			| readonly { readonly width: number; readonly height: number }[]
			| undefined = undefined,
	) => {
		const sent: string[] = [];
		let handlers:
			| { onMessage: (text: string) => void; onClose: (reason: string) => void }
			| undefined;
		let connections = 0;
		let asked = 0;
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
			page: async () => {
				if (pageSize === undefined) return undefined;
				if (!Array.isArray(pageSize)) return pageSize;

				const answer = pageSize[Math.min(asked, pageSize.length - 1)];
				asked += 1;

				return answer;
			},
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
			frame: (data: string, width = 1_280, height = 720) =>
				handlers?.onMessage(
					JSON.stringify({
						type: "frame",
						seq: 7,
						data,
						metadata: { deviceWidth: width, deviceHeight: height },
					}),
				),
			feed: (message: unknown) => handlers?.onMessage(JSON.stringify(message)),
			drop: (reason: string) => handlers?.onClose(reason),
		};
	};

	const quiet = scenario(undefined);
	quiet.hub.touch();
	const quietAnswer = quiet.hub.snapshot();
	expect(
		quiet.hub.state().open === false,
		"a hub nobody opened a browser in has no chip",
	).toBe(true);
	expect(
		quietAnswer.connected === false,
		"a panel may ask before any browser exists",
	).toBe(true);
	expect(
		quietAnswer.phase === "none" &&
			String(quietAnswer.message).includes("Nothing has been opened"),
		"and is told, in neutral words, that there is nothing yet",
	).toBe(true);
	expect(quietAnswer.error === undefined, "which is not an error").toBe(true);
	expect(quiet.connections() === 0, "without the CLI being asked").toBe(true);
	quiet.hub.stop();

	const running = scenario(4242, { width: 1_280, height: 633 });
	running.hub.touch();
	expect(
		running.connections() === 0,
		"asking alone still does not start a browser",
	).toBe(true);

	running.hub.markLive();
	running.hub.touch();
	await tick();
	expect(
		running.connections() === 1,
		"a tool call plus a poll is what connects",
	).toBe(true);
	expect(
		running.sent[0]?.includes('"maxFps"') === true,
		"and the screencast is asked for a bounded frame rate",
	).toBe(true);
	expect(
		running.hub.snapshot().connected === true,
		"which the answer says",
	).toBe(true);

	running.feed({
		type: "tabs",
		tabs: [{ active: true, url: "http://x/", title: "X" }],
	});
	const addressed = running.hub.snapshot();
	expect(addressed.url === "http://x/", "the address reaches the reader").toBe(
		true,
	);
	expect(addressed.title === "X", "with the page's title").toBe(true);

	running.frame("jpegbytes");
	expect(
		running.hub.latestFrame()?.data === "jpegbytes",
		"a frame is kept for the picture route",
	).toBe(true);
	expect(
		running.hub.snapshot().seq === 7,
		"and its sequence is what a reader keys on",
	).toBe(true);

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
	expect(feed.length === 2, "the feed is a window, not an append").toBe(true);
	expect(feed[0]?.text === "click @e2", "the command leads").toBe(true);
	expect(feed[1]?.text === "10ms", "and its outcome follows").toBe(true);
	expect(
		feed.every((item) => !item.text.includes("launch")),
		"while the CLI's own attach is left out",
	).toBe(true);

	await tick();
	expect(
		running.hub.snapshot().page.height === 633,
		"the page's own size is measured, not guessed",
	).toBe(true);

	const clicked = running.hub.sendInput({
		type: "mouse",
		event: "click",
		x: 10,
		y: 20,
		button: "left",
		modifiers: { alt: false, ctrl: false, meta: false, shift: false },
	});
	expect(
		clicked === true,
		"a person's click goes down the open connection",
	).toBe(true);
	expect(
		running.sent.some((text) => text.includes("mousePressed")) &&
			running.sent.some((text) => text.includes("mouseReleased")),
		"as the press and the release the page expects",
	).toBe(true);
	const told = String(running.hub.takeNote());
	expect(
		told.includes("clicked at (10, 20)"),
		"and the agent is told what it did not see",
	).toBe(true);
	expect(
		told.includes("take a fresh snapshot"),
		"with the warning that its refs may be stale",
	).toBe(true);
	expect(
		running.hub.takeNote() === undefined,
		"and is told once, not in every result",
	).toBe(true);
	expect(
		running.hub
			.snapshot()
			.activity.some(
				(item) => item.kind === "human" && item.text === "click 10×20",
			),
		"and is the person's own line in the feed",
	).toBe(true);

	running.feed({ type: "result", id: "r9", action: "click", duration_ms: 4 });
	expect(
		!running.hub.snapshot().activity.some((item) => item.text === "4ms"),
		"an outcome nobody saw the command for is not a line",
	).toBe(true);

	const key = (letter: string, keyName = letter) =>
		running.hub.sendInput({
			type: "key",
			event: "down",
			key: keyName,
			code: "",
			modifiers: { alt: false, ctrl: false, meta: false, shift: false },
		});

	key("h");
	key("i");
	key("Enter", "Enter");
	const typed = running.hub.snapshot().activity;
	expect(
		typed.some((item) => item.kind === "human" && item.text === "type hi"),
		"a run of typed letters is one line, not one line per key",
	).toBe(true);
	expect(
		typed.some((item) => item.kind === "human" && item.text === "key Enter"),
		"while a named key is its own act",
	).toBe(true);
	expect(
		String(running.hub.takeNote()).includes('typed "hi"'),
		"and the agent is told what was typed",
	).toBe(true);

	running.hub.announce("back", "back");
	running.feed({
		type: "command",
		id: "r7",
		action: "back",
		params: {},
		timestamp: 9,
	});
	expect(
		running.hub
			.snapshot()
			.activity.some((item) => item.kind === "human" && item.text === "back"),
		"a navigation the person caused reads as theirs",
	).toBe(true);

	const before = running.connections();

	running.hub.announce("set", "resize 390×844");
	running.feed({
		type: "command",
		id: "r8",
		action: "set",
		params: { viewport: "390 844" },
		timestamp: 10,
	});
	expect(
		running.hub
			.snapshot()
			.activity.some(
				(item) => item.kind === "human" && item.text === "resize 390×844",
			),
		"and so does a page size it changed",
	).toBe(true);
	expect(running.connections() === before, "without starting another").toBe(
		true,
	);

	running.drop("the browser went away");
	const lost = running.hub.snapshot();
	expect(
		lost.connected === false,
		"a dropped screencast is answered as not connected",
	).toBe(true);
	expect(
		lost.phase === "unreachable" &&
			String(lost.error).includes("the browser went away"),
		"with the reason it dropped, as a failure worth retrying",
	).toBe(true);
	expect(lost.retryable === true, "and the Retry it needs").toBe(true);
	expect(
		running.hub.latestFrame() !== undefined && lost.seq === 7,
		"while the last picture is kept instead of pretending nothing was seen",
	).toBe(true);
	expect(
		running.hub.state().url === "http://x/" &&
			running.hub.state().open === true,
		"a session that never opened a browser has nothing to show",
	).toBe(true);

	expect(
		running.hub.sendInput({
			type: "wheel",
			x: 1,
			y: 2,
			deltaX: 0,
			deltaY: 10,
		}) === false,
		"a click with nothing to carry it is refused",
	).toBe(true);

	const afterDrop = running.connections();
	running.hub.retry();
	await tick();
	await tick();
	expect(
		running.connections() === afterDrop + 1 &&
			running.hub.snapshot().phase === "live",
		"Retry spends the budget again and reconnects",
	).toBe(true);
	running.hub.stop();

	const relayout = scenario(4245, [
		{ width: 1_280, height: 633 },
		{ width: 390, height: 844 },
	]);
	relayout.hub.markLive();
	relayout.hub.touch();
	await tick();
	await tick();
	expect(
		relayout.hub.snapshot().page.height === 633,
		"a page is measured when the view connects",
	).toBe(true);
	relayout.frame("jpegbytes", 390, 844);
	await tick();
	await tick();
	expect(
		relayout.hub.snapshot().page.height === 844,
		"and again when the window it is drawn in changes",
	).toBe(true);
	relayout.hub.stop();

	const closing = scenario(4243);
	closing.hub.markLive();
	closing.hub.touch();
	await tick();
	closing.hub.markClosed();
	const shutdown = closing.hub.snapshot();
	expect(
		shutdown.phase === "closed" && String(shutdown.message).includes("closed"),
		"a browser closed on purpose is its own neutral state",
	).toBe(true);
	expect(
		shutdown.error === undefined && shutdown.retryable === false,
		"not an error, and nothing to retry",
	).toBe(true);
	expect(closing.connections() === 1, "and is not looked for again").toBe(true);
	closing.hub.stop();

	const leaving = scenario(4244);
	leaving.hub.markLive();
	leaving.hub.touch();
	await tick();
	expect(
		leaving.closed() === false,
		"the connection is open while somebody asks",
	).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(
		leaving.closed() === true,
		"and is dropped a while after the last poll",
	).toBe(true);
	expect(
		leaving.hub.snapshot().phase === "paused" &&
			leaving.hub.snapshot().paused === true,
		"as a pause, not an error",
	).toBe(true);
	leaving.hub.stop();

	const unknown = scenario(undefined);
	unknown.hub.markLive();
	unknown.hub.touch();
	await tick();
	await tick();
	const missing = unknown.hub.snapshot();
	expect(
		missing.phase === "none" &&
			String(missing.message).includes("No browser is running"),
		"a session whose browser is not running is told apart from one never opened",
	).toBe(true);
	expect(missing.retryable === true, "and can be retried").toBe(true);
	expect(unknown.connections() === 0, "and no connection was attempted").toBe(
		true,
	);
	unknown.hub.stop();
});

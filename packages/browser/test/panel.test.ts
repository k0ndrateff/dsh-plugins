/**
 * The three routes the panel lives on.
 *
 * The handler is called with a fake request and a fake answer, so every answer is
 * checked as an answer: the JSON a poll gets, the bytes a picture gets, and the
 * two ways a picture declines to be sent — there is none yet, and the reader
 * already has this one.
 *
 *   bun run test/panel.ts
 */

import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createPanelHandler } from "../src/host/panel/route";
import type { AgentBrowserRunner } from "../src/host/runner";
import { StreamHub } from "../src/host/stream/hub";
import { StreamHubs } from "../src/host/stream/hubs";
import type { WirePeer } from "../src/host/wire/peer";

/** One answer, as the handler produced it. */
interface Answer {
	readonly status: number;
	readonly headers: Record<string, string>;
	readonly body: string;
	readonly bytes: number | undefined;
}

/** The session every case here asks about. */
const SESSION = "dsh-test";

/** A response that remembers what it was told. */
const answering = (): { response: ServerResponse; answer: Answer } => {
	const answer = {
		status: 0,
		headers: {} as Record<string, string>,
		body: "",
		bytes: undefined as number | undefined,
	};

	const response = {
		writeHead: (status: number, headers?: Record<string, string>) => {
			answer.status = status;
			answer.headers = headers ?? {};

			return response;
		},
		end: (body?: unknown) => {
			if (typeof body === "string") answer.body = body;
			else if (body instanceof Uint8Array) answer.bytes = body.byteLength;

			return response;
		},
	} as unknown as ServerResponse;

	return { response, answer };
};

/** One call through the handler, with a body when the route takes one. */
const call = async (
	handler: (
		request: IncomingMessage,
		response: ServerResponse,
	) => Promise<void>,
	url: string,
	method = "GET",
	body?: unknown,
): Promise<Answer> => {
	const { response, answer } = answering();
	const headers = {
		host: "127.0.0.1:52849",
		origin: "http://127.0.0.1:52849",
		"sec-fetch-site": "same-origin",
		"x-dsh-client": "1",
		"content-type": "application/json",
	};
	const request =
		body === undefined
			? ({ url, method, headers } as unknown as IncomingMessage)
			: (Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
					url,
					method,
					headers,
				}) as unknown as IncomingMessage);

	await handler(request, response);

	return answer;
};

/** The session's screencast, as the test decides it. */
const screencast = (port: number | undefined) => {
	const sent: string[] = [];
	let handlers:
		| { onMessage: (text: string) => void; onClose: (reason: string) => void }
		| undefined;

	const peer = {
		send: (text: string) => sent.push(text),
		close: () => {},
	} as unknown as WirePeer;

	const hubs = new StreamHubs(
		(session) =>
			new StreamHub({
				session,
				port: async () => port,
				connect: async (_port, given) => {
					handlers = given;

					return peer;
				},
				idleMs: 20,
			}),
	);

	return {
		hubs,
		sent,
		feed: (message: unknown) => handlers?.onMessage(JSON.stringify(message)),
		picture: (data: string, seq: number) =>
			handlers?.onMessage(
				JSON.stringify({
					type: "frame",
					seq,
					data,
					metadata: { deviceWidth: 1280, deviceHeight: 720 },
				}),
			),
	};
};

/** A runner that answers the one command the close route sends. */
const closingRunner = (ok: boolean) => {
	const commands: string[][] = [];
	const runner = {
		run: async (command: { args: readonly string[] }) => {
			commands.push([...command.args]);

			return ok
				? { ok: true, data: {}, durationMs: 1 }
				: { ok: false, error: "no browser to close", durationMs: 1 };
		},
	} as unknown as AgentBrowserRunner;

	return { runner, commands };
};

const json = (answer: Answer): Record<string, unknown> =>
	JSON.parse(answer.body) as Record<string, unknown>;

const idle = screencast(undefined);
const idleHandler = createPanelHandler({
	hubs: idle.hubs,
	runner: closingRunner(true).runner,
});
const live = screencast(4242);
const liveHandler = createPanelHandler({
	hubs: live.hubs,
	runner: closingRunner(true).runner,
});

test("naming the session", async () => {
	const unnamed = screencast(4242);
	const nameless = createPanelHandler({
		hubs: unnamed.hubs,
		runner: closingRunner(true).runner,
	});
	expect(
		(await call(nameless, "/dsh-browser/panel")).status === 400,
		"a poll without a session name is refused",
	).toBe(true);
	expect(
		(await call(nameless, "/dsh-browser/panel?session=other")).status === 400,
		"and so is a fabricated one",
	).toBe(true);
});
test("what a poll answers", async () => {
	const first = await call(
		idleHandler,
		`/dsh-browser/panel?session=${SESSION}`,
	);
	expect(first.status === 200, "a poll is answered").toBe(true);
	expect(
		first.headers["cache-control"] === "no-store" &&
			first.headers["content-type"]?.includes("application/json") === true,
		"as JSON nothing caches",
	).toBe(true);
	expect(json(first).connected === false, "with no connection yet").toBe(true);
	expect(
		json(first).phase === "none",
		"a browser that was never opened is a state, not an error",
	).toBe(true);
	expect(
		String(json(first).message).includes("Nothing has been opened") &&
			json(first).error === undefined,
		"and the person reads a neutral sentence instead of a red one",
	).toBe(true);
	expect(json(first).seq === 0, "and no picture to key on").toBe(true);
});
test("a panel that is watching", async () => {
	live.hubs.markLive(SESSION);
	const started = await call(
		liveHandler,
		`/dsh-browser/panel?session=${SESSION}`,
	);
	expect(live.sent.length === 1, "the poll is what starts the screencast").toBe(
		true,
	);
	expect(
		live.sent[0]?.includes('"maxFps"') === true,
		"asking it for a bounded frame rate",
	).toBe(true);
	expect(
		json(started).connected === false,
		"and answers before the connection is up",
	).toBe(true);
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	const next = await call(liveHandler, `/dsh-browser/panel?session=${SESSION}`);
	expect(
		json(next).connected === true,
		"the next poll reports the connection",
	).toBe(true);

	live.feed({
		type: "tabs",
		tabs: [{ active: true, url: "http://x/", title: "X" }],
	});
	live.feed({
		type: "command",
		id: "r1",
		action: "click",
		params: { selector: "@e2" },
		timestamp: 5,
	});
	live.picture(Buffer.from("jpegbytes").toString("base64"), 7);
	const watching = json(
		await call(liveHandler, `/dsh-browser/panel?session=${SESSION}`),
	);
	expect(watching.url === "http://x/", "the address is carried").toBe(true);
	expect(watching.title === "X", "with the title").toBe(true);
	expect(watching.seq === 7, "and the frame a reader should ask for").toBe(
		true,
	);
	expect(
		Array.isArray(watching.activity) && watching.activity.length === 1,
		"and the feed",
	).toBe(true);
});
test("the picture", async () => {
	expect(
		(await call(idleHandler, `/dsh-browser/frame?session=${SESSION}`))
			.status === 204,
		"a reader with nothing gets no picture",
	).toBe(true);

	const same = await call(
		liveHandler,
		`/dsh-browser/frame?session=${SESSION}&seq=7`,
	);
	expect(
		same.status === 200,
		"a reader asking for the frame it has still gets it",
	).toBe(true);
	expect(
		same.bytes === Buffer.byteLength("jpegbytes"),
		"because a picture served with no-store cannot be `not modified`",
	).toBe(true);

	const fresh = await call(
		liveHandler,
		`/dsh-browser/frame?session=${SESSION}&seq=6`,
	);
	expect(
		fresh.status === 200,
		"a reader that has an older one gets the picture",
	).toBe(true);
	expect(fresh.headers["content-type"] === "image/jpeg", "as JPEG bytes").toBe(
		true,
	);
	expect(
		fresh.bytes === Buffer.byteLength("jpegbytes"),
		"the whole picture, decoded",
	).toBe(true);

	expect(
		(await call(liveHandler, `/dsh-browser/nope?session=${SESSION}`)).status ===
			404,
		"an unknown path is not found",
	).toBe(true);
});
test("the chip's question", async () => {
	const status = await call(
		idleHandler,
		`/dsh-browser/state?session=${SESSION}`,
	);
	expect(
		json(status).open === false,
		"a conversation without a browser says so",
	).toBe(true);
	expect(
		idle.sent.length === 0 && idle.hubs.state(SESSION).open === false,
		"and asking does not start watching",
	).toBe(true);

	live.hubs.markLive(SESSION);
	const known = json(
		await call(liveHandler, `/dsh-browser/state?session=${SESSION}`),
	);
	expect(known.open === true, "a browser that was opened says so").toBe(true);
	expect(known.url === "http://x/", "with the page it was last seen on").toBe(
		true,
	);
	expect(
		live.hubs.state(SESSION).open === true,
		"and the answer costs no connection",
	).toBe(true);
});
test("a person's click", async () => {
	const poke = screencast(4242);
	const { runner: poking, commands: poked } = closingRunner(true);
	const pokeHandler = createPanelHandler({ hubs: poke.hubs, runner: poking });

	const cursor = { x: 10, y: 20, button: "left" };
	const early = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "mouse", event: "click", ...cursor },
	);
	expect(
		early.status === 409 && String(json(early).error).includes("not connected"),
		"a click with nothing to carry it is refused",
	).toBe(true);

	poke.hubs.markLive(SESSION);
	await call(pokeHandler, `/dsh-browser/panel?session=${SESSION}`);
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await call(pokeHandler, `/dsh-browser/panel?session=${SESSION}`);

	const clicked = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "mouse", event: "click", ...cursor },
	);
	expect(clicked.status === 200, "a click on a live view is taken").toBe(true);
	expect(json(clicked).ok === true, "and says so").toBe(true);
	expect(
		poke.sent.some((text) => text.includes("mousePressed")),
		"and the page is told about it",
	).toBe(true);
	expect(
		(
			await call(pokeHandler, `/dsh-browser/panel?session=${SESSION}`)
		).body.includes('"human"'),
		"with the person's act in the feed",
	).toBe(true);

	const nonsense = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "mouse", event: "click" },
	);
	expect(
		nonsense.status === 400 &&
			String(json(nonsense).error).includes("x and a y"),
		"a click with no point is refused with a reason",
	).toBe(true);

	const heavy = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "wheel", x: 1, y: 2, deltaY: 1, pad: "x".repeat(4_096) },
	);
	expect(heavy.status === 413, "a body too big to be a click is refused").toBe(
		true,
	);

	const moved = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "navigate", to: "back" },
	);
	expect(poked[0]?.join(" ") === "back", "going back runs the CLI").toBe(true);
	expect(json(moved).ok === true, "and is reported as done").toBe(true);

	const sized = await call(
		pokeHandler,
		`/dsh-browser/input?session=${SESSION}`,
		"POST",
		{ type: "viewport", width: 390, height: 844 },
	);
	expect(
		poked[1]?.join(" ") === "set viewport 390 844",
		"a page size runs the CLI's own setter",
	).toBe(true);
	expect(json(sized).ok === true, "and is reported as done").toBe(true);

	const told = String(poke.hubs.takeNote(SESSION));
	expect(
		told.includes("changed the page size to 390×844"),
		"the agent is told the page size changed",
	).toBe(true);
	expect(told.includes("went back"), "and that the page was navigated").toBe(
		true,
	);
	expect(
		poke.hubs.takeNote(SESSION) === undefined,
		"and told once, not in every call",
	).toBe(true);

	expect(
		(await call(pokeHandler, `/dsh-browser/input?session=${SESSION}`))
			.status === 404,
		"and an input is never a poll",
	).toBe(true);
});
test("closing the browser", async () => {
	const closed = screencast(4242);
	const { runner: closes, commands } = closingRunner(true);
	const closeHandler = createPanelHandler({
		hubs: closed.hubs,
		runner: closes,
	});
	closed.hubs.markLive(SESSION);
	const answer = await call(
		closeHandler,
		`/dsh-browser/close?session=${SESSION}`,
		"POST",
	);
	expect(commands[0]?.join(" ") === "close", "the close runs the CLI").toBe(
		true,
	);
	expect(json(answer).closed === true, "and is reported as done").toBe(true);
	const after = json(
		await call(closeHandler, `/dsh-browser/panel?session=${SESSION}`),
	);
	expect(
		after.phase === "closed" && String(after.message).includes("closed"),
		"a closed browser is its own neutral state",
	).toBe(true);
	expect(
		after.url === "" && after.title === "",
		"with the old address and title cleared",
	).toBe(true);
	expect(
		closed.hubs.state(SESSION).open === false,
		"and the chip has nothing to offer any more",
	).toBe(true);
	expect(
		String(closed.hubs.takeNote(SESSION)).includes("closed the browser"),
		"and the agent is told the person closed it",
	).toBe(true);

	const refusing = screencast(4242);
	const refusingHandler = createPanelHandler({
		hubs: refusing.hubs,
		runner: closingRunner(false).runner,
	});
	const refused = await call(
		refusingHandler,
		`/dsh-browser/close?session=${SESSION}`,
		"POST",
	);
	expect(json(refused).closed === false, "a close that failed says so").toBe(
		true,
	);
	expect(
		String(json(refused).error).includes("no browser to close"),
		"with the CLI's own reason",
	).toBe(true);
	expect(
		(await call(refusingHandler, `/dsh-browser/close?session=${SESSION}`))
			.status === 404,
		"and a close is never a poll",
	).toBe(true);
});

test("asking the host to try again", async () => {
	const { response, answer } = answering();
	const request = {
		url: `/dsh-browser/retry?session=${SESSION}`,
		method: "POST",
		headers: {
			host: "127.0.0.1:52849",
			origin: "http://127.0.0.1:52849",
			"sec-fetch-site": "same-origin",
			"x-dsh-client": "1",
			"content-type": "application/json",
		},
	} as unknown as IncomingMessage;

	const retried = screencast(4242);
	retried.hubs.markLive(SESSION);
	await createPanelHandler({
		hubs: retried.hubs,
		runner: closingRunner(true).runner,
	})(request, response);

	expect(answer.status === 200, "a retry is answered").toBe(true);
	expect(json(answer).session === SESSION, "with the session it is about").toBe(
		true,
	);
	expect(
		retried.hubs.for(SESSION).snapshot().phase === "starting",
		"and restarts the connection instead of waiting for a tool call",
	).toBe(true);
});

test("the machine check route", async () => {
	const reporting = {
		status: async () => ({
			version: "0.35.1",
			chrome: "Google Chrome 155",
			checks: [
				{
					id: "chrome.installed",
					label: "Chrome",
					status: "pass",
					message: "Google Chrome 155",
				},
				{
					id: "launch.launch",
					label: "Browser launch",
					status: "fail",
					message: "CDP response channel closed",
				},
			],
		}),
	} as unknown as AgentBrowserRunner;
	const handler = createPanelHandler({ hubs: idle.hubs, runner: reporting });
	const answer = await call(handler, "/dsh-browser/doctor");

	expect(answer.status === 200, "doctor is answered without a session").toBe(
		true,
	);
	expect(json(answer).ok === true, "and reports the machine").toBe(true);
	expect(
		Array.isArray(json(answer).checks) &&
			(json(answer).checks as { label?: string }[])[1]?.label ===
				"Browser launch",
		"with human names for the checks the settings page shows",
	).toBe(true);

	const missing = createPanelHandler({
		hubs: idle.hubs,
		runner: { status: async () => undefined } as unknown as AgentBrowserRunner,
	});
	const refused = await call(missing, "/dsh-browser/doctor");
	expect(
		json(refused).ok === false &&
			String(json(refused).error).includes("not on PATH"),
		"and the CLI that is missing is named with what to do",
	).toBe(true);
});

test("the page as text", async () => {
	const treeRunner = {
		run: async () => ({
			ok: true,
			data: {
				origin: "http://x/",
				snapshot: '- button "Save" [ref=e1]',
				refs: { e1: { name: "Save", role: "button" } },
			},
			durationMs: 1,
		}),
	} as unknown as AgentBrowserRunner;
	const handler = createPanelHandler({ hubs: idle.hubs, runner: treeRunner });
	const answer = await call(handler, `/dsh-browser/text?session=${SESSION}`);

	expect(answer.status === 200, "the text view is answered").toBe(true);
	expect(
		String(json(answer).text).includes("[ref=e1]"),
		"with the same tree the agent reads",
	).toBe(true);
	expect(json(answer).url === "http://x/", "and the page it came from").toBe(
		true,
	);

	const broken = createPanelHandler({
		hubs: idle.hubs,
		runner: {
			run: async () => ({
				ok: false,
				error: "browser not launched",
				durationMs: 1,
			}),
		} as unknown as AgentBrowserRunner,
	});
	const refused = await call(broken, `/dsh-browser/text?session=${SESSION}`);
	expect(
		refused.status === 409 &&
			String(json(refused).error).includes("browser not launched"),
		"and a page that cannot be read says why",
	).toBe(true);
});

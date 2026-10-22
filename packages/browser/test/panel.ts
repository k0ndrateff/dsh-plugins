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

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createPanelHandler } from "../src/host/panel/route";
import type { AgentBrowserRunner } from "../src/host/runner";
import { StreamHub } from "../src/host/stream/hub";
import { StreamHubs } from "../src/host/stream/hubs";
import type { WirePeer } from "../src/host/wire/peer";
import { check, report, section } from "./harness";

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
	const request =
		body === undefined
			? ({ url, method } as IncomingMessage)
			: (Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
					url,
					method,
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

section("naming the session");
const unnamed = screencast(4242);
const nameless = createPanelHandler({
	hubs: unnamed.hubs,
	runner: closingRunner(true).runner,
});
check(
	"a poll without a session name is refused",
	(await call(nameless, "/dsh-browser/panel")).status === 400,
);
check(
	"and so is a fabricated one",
	(await call(nameless, "/dsh-browser/panel?session=other")).status === 400,
);

section("what a poll answers");
const idle = screencast(undefined);
const idleHandler = createPanelHandler({
	hubs: idle.hubs,
	runner: closingRunner(true).runner,
});
const first = await call(idleHandler, `/dsh-browser/panel?session=${SESSION}`);
check("a poll is answered", first.status === 200);
check(
	"as JSON nothing caches",
	first.headers["cache-control"] === "no-store" &&
		first.headers["content-type"]?.includes("application/json") === true,
);
check("with no connection yet", json(first).connected === false);
check(
	"and a reason to act on",
	String(json(first).error).includes("no browser"),
);
check("and no picture to key on", json(first).seq === 0);

section("a panel that is watching");
const live = screencast(4242);
const liveHandler = createPanelHandler({
	hubs: live.hubs,
	runner: closingRunner(true).runner,
});

live.hubs.markLive(SESSION);
const started = await call(
	liveHandler,
	`/dsh-browser/panel?session=${SESSION}`,
);
check("the poll is what starts the screencast", live.sent.length === 1);
check(
	"asking it for a bounded frame rate",
	live.sent[0]?.includes('"maxFps"') === true,
);
check(
	"and answers before the connection is up",
	json(started).connected === false,
);
await new Promise((resolve) => {
	setTimeout(resolve, 0);
});
const next = await call(liveHandler, `/dsh-browser/panel?session=${SESSION}`);
check("the next poll reports the connection", json(next).connected === true);

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
check("the address is carried", watching.url === "http://x/");
check("with the title", watching.title === "X");
check("and the frame a reader should ask for", watching.seq === 7);
check(
	"and the feed",
	Array.isArray(watching.activity) && watching.activity.length === 1,
);

section("the picture");
check(
	"a reader with nothing gets no picture",
	(await call(idleHandler, `/dsh-browser/frame?session=${SESSION}`)).status ===
		204,
);

const same = await call(
	liveHandler,
	`/dsh-browser/frame?session=${SESSION}&seq=7`,
);
check(
	"a reader asking for the frame it has still gets it",
	same.status === 200,
);
check(
	"because a picture served with no-store cannot be `not modified`",
	same.bytes === Buffer.byteLength("jpegbytes"),
);

const fresh = await call(
	liveHandler,
	`/dsh-browser/frame?session=${SESSION}&seq=6`,
);
check("a reader that has an older one gets the picture", fresh.status === 200);
check("as JPEG bytes", fresh.headers["content-type"] === "image/jpeg");
check(
	"the whole picture, decoded",
	fresh.bytes === Buffer.byteLength("jpegbytes"),
);

check(
	"an unknown path is not found",
	(await call(liveHandler, `/dsh-browser/nope?session=${SESSION}`)).status ===
		404,
);

section("the chip's question");
const status = await call(idleHandler, `/dsh-browser/state?session=${SESSION}`);
check("a conversation without a browser says so", json(status).open === false);
check(
	"and asking does not start watching",
	idle.sent.length === 0 && idle.hubs.state(SESSION).open === false,
);

live.hubs.markLive(SESSION);
const known = json(
	await call(liveHandler, `/dsh-browser/state?session=${SESSION}`),
);
check("a browser that was opened says so", known.open === true);
check("with the page it was last seen on", known.url === "http://x/");
check(
	"and the answer costs no connection",
	live.hubs.state(SESSION).open === true,
);

section("a person's click");
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
check(
	"a click with nothing to carry it is refused",
	early.status === 409 && String(json(early).error).includes("not connected"),
);

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
check("a click on a live view is taken", clicked.status === 200);
check("and says so", json(clicked).ok === true);
check(
	"and the page is told about it",
	poke.sent.some((text) => text.includes("mousePressed")),
);
check(
	"with the person's act in the feed",
	(
		await call(pokeHandler, `/dsh-browser/panel?session=${SESSION}`)
	).body.includes('"human"'),
);

const nonsense = await call(
	pokeHandler,
	`/dsh-browser/input?session=${SESSION}`,
	"POST",
	{ type: "mouse", event: "click" },
);
check(
	"a click with no point is refused with a reason",
	nonsense.status === 400 && String(json(nonsense).error).includes("x and a y"),
);

const heavy = await call(
	pokeHandler,
	`/dsh-browser/input?session=${SESSION}`,
	"POST",
	{ type: "wheel", x: 1, y: 2, deltaY: 1, pad: "x".repeat(4_096) },
);
check("a body too big to be a click is refused", heavy.status === 413);

const moved = await call(
	pokeHandler,
	`/dsh-browser/input?session=${SESSION}`,
	"POST",
	{ type: "navigate", to: "back" },
);
check("going back runs the CLI", poked[0]?.join(" ") === "back");
check("and is reported as done", json(moved).ok === true);

const sized = await call(
	pokeHandler,
	`/dsh-browser/input?session=${SESSION}`,
	"POST",
	{ type: "viewport", width: 390, height: 844 },
);
check(
	"a page size runs the CLI's own setter",
	poked[1]?.join(" ") === "set viewport 390 844",
);
check("and is reported as done", json(sized).ok === true);

const told = String(poke.hubs.takeNote(SESSION));
check(
	"the agent is told the page size changed",
	told.includes("changed the page size to 390×844"),
);
check("and that the page was navigated", told.includes("went back"));
check(
	"and told once, not in every call",
	poke.hubs.takeNote(SESSION) === undefined,
);

check(
	"and an input is never a poll",
	(await call(pokeHandler, `/dsh-browser/input?session=${SESSION}`)).status ===
		404,
);

section("closing the browser");
const closed = screencast(4242);
const { runner: closes, commands } = closingRunner(true);
const closeHandler = createPanelHandler({ hubs: closed.hubs, runner: closes });
closed.hubs.markLive(SESSION);
const answer = await call(
	closeHandler,
	`/dsh-browser/close?session=${SESSION}`,
	"POST",
);
check("the close runs the CLI", commands[0]?.join(" ") === "close");
check("and is reported as done", json(answer).closed === true);
const after = json(
	await call(closeHandler, `/dsh-browser/panel?session=${SESSION}`),
);
check(
	"and the session stops being looked for",
	String(after.error).includes("closed"),
);
check(
	"and the chip has nothing to offer any more",
	closed.hubs.state(SESSION).open === false,
);

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
check("a close that failed says so", json(refused).closed === false);
check(
	"with the CLI's own reason",
	String(json(refused).error).includes("no browser to close"),
);
check(
	"and a close is never a poll",
	(await call(refusingHandler, `/dsh-browser/close?session=${SESSION}`))
		.status === 404,
);

report();

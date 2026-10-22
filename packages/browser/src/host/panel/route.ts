/**
 * The panel's four ways in: what to draw, the picture itself, one act of the
 * person watching, and the one write that closes a browser.
 *
 * Ordinary routes on the harness's web server, mounted through
 * `mountIntegrationRoute` — which waits for the web server rather than asking for
 * it at activation time, a race this repository has already paid for. They are
 * ordinary on purpose: the Desktop application serves its page from `dsh-app://`,
 * where a `WebSocket` cannot be constructed at all, so a socket could never have
 * been the transport. Every other panel here reaches its host the same way.
 *
 * The picture is bytes rather than a document: an image cannot travel inside the
 * JSON that describes it, and `sendBytes` is what this suite already uses for
 * one. The `seq` in the address is a key the *page* uses to make each frame's
 * address new; the route itself answers with whatever frame it has.
 *
 * A person's click arrives as a small JSON body and leaves as a message on the
 * connection this route already holds, except for the three navigations, which
 * are the CLI's own commands and are run as such.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import {
	clientRequestRefusal,
	mountIntegrationRoute,
} from "dsh-integration-host";
import {
	CLOSE_PATH,
	FRAME_PATH,
	INPUT_PATH,
	PANEL_PATH,
	type PanelInput,
	ROUTE_PREFIX,
	STATE_PATH,
} from "../../shared/panel";
import type { AgentBrowserRunner } from "../runner";
import { isSessionName } from "../session";
import type { StreamHubs } from "../stream/hubs";
import { noteOf } from "../stream/input";
import { type InputReading, readPanelInput } from "./input";

/** What the panel route needs from the plugin. */
export interface PanelRouteDeps {
	readonly hubs: StreamHubs;
	readonly runner: AgentBrowserRunner;
}

/** How long the close command may take. */
const CLOSE_TIMEOUT_MS = 15_000;

/** A navigation may be a whole page load, so it is given the tool's own minute. */
const NAVIGATE_TIMEOUT_MS = 60_000;

/** The largest input body one request may carry; a click is a few dozen bytes. */
const MAX_BODY_BYTES = 4_096;

/** The headers every answer here carries: nothing about a live view is cacheable. */
const NO_STORE = "no-store";

/** One JSON reply. */
const reply = (
	response: ServerResponse,
	status: number,
	body: unknown,
): void => {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": NO_STORE,
	});
	response.end(JSON.stringify(body));
};

/** Answer with nothing: there is no frame to show yet. */
const noFrame = (response: ServerResponse): void => {
	response.writeHead(204, { "cache-control": NO_STORE });
	response.end();
};

/** Answer with one JPEG. */
const sendFrame = (response: ServerResponse, data: string): void => {
	const bytes = Buffer.from(data, "base64");

	response.writeHead(200, {
		"content-type": "image/jpeg",
		"content-length": bytes.byteLength,
		"cache-control": NO_STORE,
	});
	response.end(bytes);
};

/** The session one request asks about, when it names a real one. */
const sessionOf = (url: URL): string | undefined => {
	const session = url.searchParams.get("session") ?? "";

	return isSessionName(session) ? session : undefined;
};

/** The whole body of one request, or undefined when it is too long to be one. */
const bodyOf = async (
	request: IncomingMessage,
): Promise<string | undefined> => {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

		size += bytes.byteLength;

		if (size > MAX_BODY_BYTES) return undefined;

		chunks.push(bytes);
	}

	return Buffer.concat(chunks).toString("utf8");
};

/** What one body parsed to, when it parses at all. */
const parsedOf = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

/**
 * The CLI command one input becomes, when it is a command at all.
 *
 * Going back and resizing the page are the CLI's own verbs, and the stream's
 * client side has no message for either: they are the two inputs that leave the
 * connection alone.
 * @param input - a navigation or a viewport.
 */
const commandOf = (
	input: Extract<PanelInput, { readonly type: "navigate" | "viewport" }>,
): readonly string[] =>
	input.type === "navigate"
		? [input.to]
		: ["set", "viewport", String(input.width), String(input.height)];

/**
 * Read one request's input, or answer the reason it is not one.
 * @returns the reading, or undefined when the answer has already been sent.
 */
const inputOf = async (
	request: IncomingMessage,
	response: ServerResponse,
): Promise<InputReading | undefined> => {
	const body = await bodyOf(request);

	if (body === undefined) {
		reply(response, 413, { error: "that input is longer than a click" });

		return undefined;
	}

	const reading = readPanelInput(parsedOf(body));

	if (!reading.ok) {
		reply(response, 400, { error: reading.reason });

		return undefined;
	}

	return reading;
};

/**
 * Build the request handler, which the composition root mounts.
 * @param deps - the hubs the poll answers from, and the runner the close uses.
 */
export const createPanelHandler = (
	deps: PanelRouteDeps,
): ((request: IncomingMessage, response: ServerResponse) => Promise<void>) => {
	return async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const method = request.method ?? "GET";
		const refusal = clientRequestRefusal(request);

		if (refusal !== undefined) {
			reply(response, 403, { error: refusal });

			return;
		}

		const session = sessionOf(url);

		if (session === undefined) {
			reply(response, 400, { error: "that is not a browser session name" });

			return;
		}

		if (url.pathname === PANEL_PATH && method === "GET") {
			const hub = deps.hubs.for(session);

			hub.touch();
			reply(response, 200, hub.snapshot());

			return;
		}

		if (url.pathname === FRAME_PATH && method === "GET") {
			const hub = deps.hubs.for(session);

			hub.touch();

			const frame = hub.latestFrame();

			if (frame === undefined) {
				noFrame(response);

				return;
			}

			// Always the bytes, never a "not modified": the picture is served with
			// `no-store`, so a reader has no copy to be told it already has — a 304
			// here is a broken image, which is exactly what it used to be.
			sendFrame(response, frame.data);

			return;
		}

		// Answered from what the host knows, without touching the screencast: a
		// chip that asks whether a browser exists must not keep one streaming.
		if (url.pathname === STATE_PATH && method === "GET") {
			reply(response, 200, deps.hubs.state(session));

			return;
		}

		if (url.pathname === INPUT_PATH && method === "POST") {
			const reading = await inputOf(request, response);

			if (reading === undefined || !reading.ok) return;

			const hub = deps.hubs.for(session);

			hub.touch();

			if (
				reading.input.type === "navigate" ||
				reading.input.type === "viewport"
			) {
				const moved = await deps.runner.run({
					args: commandOf(reading.input),
					session,
					cwd: process.cwd(),
					signal: AbortSignal.timeout(NAVIGATE_TIMEOUT_MS),
				});

				// A navigation that ran is proof of a browser, the same as a tool call,
				// and the agent has to know the page moved under it.
				if (moved.ok) {
					deps.hubs.markLive(session);
					deps.hubs.note(session, noteOf(reading.input));
					await hub.remeasure();
				}

				reply(response, 200, {
					ok: moved.ok,
					...(moved.ok ? {} : { error: moved.error }),
				});

				return;
			}

			const sent = hub.sendInput(reading.input);

			reply(
				response,
				sent ? 200 : 409,
				sent
					? { ok: true }
					: { error: "the live view is not connected right now" },
			);

			return;
		}

		if (url.pathname === CLOSE_PATH && method === "POST") {
			const closed = await deps.runner.run({
				args: ["close"],
				session,
				cwd: process.cwd(),
				signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
			});
			if (closed.ok) deps.hubs.markClosed(session);

			reply(response, 200, {
				closed: closed.ok,
				...(closed.ok ? {} : { error: closed.error }),
			});

			return;
		}

		reply(response, 404, { error: "not-found", path: url.pathname });
	};
};

/**
 * Mount the live view, the person's input, and the close that goes with them.
 * @param ctx - the plugin's host context.
 * @param deps - the hubs the poll answers from, and the runner the commands use.
 */
export const mountPanel = (ctx: Context, deps: PanelRouteDeps): void => {
	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: createPanelHandler(deps),
	});
};

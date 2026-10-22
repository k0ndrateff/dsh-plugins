/**
 * The panel's three ways in: what to draw, the picture itself, and the one write
 * that closes a browser.
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
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { mountIntegrationRoute } from "dsh-integration-host";
import {
	CLOSE_PATH,
	FRAME_PATH,
	PANEL_PATH,
	ROUTE_PREFIX,
} from "../../shared/panel";
import type { AgentBrowserRunner } from "../runner";
import { isSessionName } from "../session";
import type { StreamHubs } from "../stream/hubs";

/** What the panel route needs from the plugin. */
export interface PanelRouteDeps {
	readonly hubs: StreamHubs;
	readonly runner: AgentBrowserRunner;
}

/** How long the close command may take. */
const CLOSE_TIMEOUT_MS = 15_000;

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

		if (url.pathname === CLOSE_PATH && method === "POST") {
			const closed = await deps.runner.run({
				args: ["close"],
				session,
				cwd: process.cwd(),
				signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
			});
			deps.hubs.markClosed(session);

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
 * Mount the live view and the close that goes with it.
 * @param ctx - the plugin's host context.
 * @param deps - the hubs the poll answers from, and the runner the close uses.
 */
export const mountPanel = (ctx: Context, deps: PanelRouteDeps): void => {
	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: createPanelHandler(deps),
	});
};

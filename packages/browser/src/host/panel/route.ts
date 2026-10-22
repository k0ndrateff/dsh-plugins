/**
 * The panel's two ways in: a socket that carries the live view, and the one
 * write that closes a browser.
 *
 * The socket is an upgrade on the harness's own origin, negotiated and admitted
 * here. Admission is the harness's own answer to "may this peer connect" —
 * `connection.admitConnection`, the same call the shipped remote-stream
 * multiplexer makes — so the panel is refused wherever that multiplexer would
 * be, instead of being a second, quieter way in.
 *
 * The route underneath is mounted through `mountIntegrationRoute`, which waits
 * for the web server rather than asking for it at activation time; that race is
 * a trap this repository has already paid for.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Context } from "@deepseek-ai/cordis";
import { mountIntegrationRoute } from "dsh-integration-host";
import { CLOSE_PATH, ROUTE_PREFIX, STREAM_PATH } from "../../shared/panel";
import type { AgentBrowserRunner } from "../runner";
import { isSessionName } from "../session";
import type { StreamHubs } from "../stream/hubs";
import {
	acceptResponse,
	isUpgradeRequest,
	KEY_HEADER,
	refusalResponse,
} from "../wire/handshake";
import { WirePeer } from "../wire/peer";

/** What the panel route needs from the plugin. */
export interface PanelRouteDeps {
	readonly hubs: StreamHubs;
	readonly runner: AgentBrowserRunner;
}

/** The web server's upgrade seat, as this plugin needs it. */
interface UpgradeHost {
	registerUpgrade(route: {
		readonly path: string;
		readonly handler: (
			request: IncomingMessage,
			socket: Duplex,
			head: Buffer,
		) => void;
	}): () => void;
}

/** The connection service's admission, as this plugin needs it. */
interface ConnectionHost {
	admitConnection(
		request: IncomingMessage,
	):
		| { readonly rejection: unknown }
		| { readonly peer: unknown; release(): Promise<void> };
}

/** How long the close command may take. */
const CLOSE_TIMEOUT_MS = 15_000;

/** One service out of an injected scoped context. */
const serviceOf = (ctx: Context, name: string): unknown =>
	(ctx as unknown as { get(key: string): unknown }).get(name);

/** Answer an upgrade we will not complete. */
const refuse = (socket: Duplex, status: number, reason: string): void => {
	socket.end(refusalResponse(status, reason));
};

/** One JSON reply, the only shape this route answers with. */
const reply = (
	response: {
		writeHead(status: number, headers: Record<string, string>): void;
		end(body: string): void;
	},
	status: number,
	body: unknown,
): void => {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
};

/**
 * Mount the live view and the close that goes with it.
 * @param ctx - the plugin's host context.
 * @param deps - the hubs the socket feeds, and the runner the close uses.
 */
export const mountPanel = (ctx: Context, deps: PanelRouteDeps): void => {
	ctx.inject(["webServer", "connection"], (scoped) => {
		const webServer = serviceOf(scoped, "webServer") as UpgradeHost;
		const connection = serviceOf(scoped, "connection") as ConnectionHost;

		scoped.effect(
			() =>
				webServer.registerUpgrade({
					path: STREAM_PATH,
					handler: (request, socket) =>
						openPanel(connection, deps, request, socket),
				}),
			`${STREAM_PATH}: upgrade`,
		);
	});

	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: async (request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			const method = request.method ?? "GET";

			if (url.pathname !== CLOSE_PATH || method !== "POST") {
				reply(response, 404, { error: "not-found", path: url.pathname });

				return;
			}

			const session = url.searchParams.get("session") ?? "";

			if (!isSessionName(session)) {
				reply(response, 400, { error: "that is not a browser session name" });

				return;
			}

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
		},
	});
};

/** Complete one upgrade, admit it, and hand the session's view to its reader. */
const openPanel = (
	connection: ConnectionHost,
	deps: PanelRouteDeps,
	request: IncomingMessage,
	socket: Duplex,
): void => {
	if (!isUpgradeRequest(request.method, request.headers)) {
		refuse(socket, 400, "this path only answers a WebSocket upgrade");

		return;
	}

	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const session = url.searchParams.get("session") ?? "";

	if (!isSessionName(session)) {
		refuse(socket, 400, "name the browser session to watch");

		return;
	}

	const admission = connection.admitConnection(request);

	if ("rejection" in admission) {
		refuse(socket, 403, "this peer may not watch the browser");

		return;
	}

	const release = (): void => {
		admission.release().catch(() => {
			// A peer the harness has already forgotten needs no second release.
		});
	};

	if (socket.destroyed) {
		release();

		return;
	}

	let peer: WirePeer | undefined;
	let unwatch: (() => void) | undefined;
	let released = false;

	const finish = (): void => {
		unwatch?.();
		unwatch = undefined;

		if (released) return;

		released = true;
		release();
	};

	socket.on("error", finish);
	socket.once("close", finish);

	socket.write(acceptResponse(String(request.headers[KEY_HEADER])));

	peer = new WirePeer(socket, {
		role: "server",
		onMessage: () => {
			// A panel only watches in this milestone: there is nothing to receive
			// until taking the browser over exists, and ignoring is honest about it.
		},
		onClose: finish,
	});

	unwatch = deps.hubs
		.for(session)
		.watch((message) => peer?.send(JSON.stringify(message)));
};

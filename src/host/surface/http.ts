/**
 * The localhost API the browser half calls.
 *
 * The settings card lives in the page, so it needs a channel to the host. A
 * named route on the harness web server is that channel: it needs no generated
 * remote namespace, it is structured JSON in both directions, and it is bound
 * to loopback exactly like the rest of the web server.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { auth } from "../auth";
import type { Config } from "../config";
import { errorText } from "../log";
import { mcpBridge } from "../mcp/bridge";
import type { RuntimeState } from "../state";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-atlassian";

/** Mount a route the web server can serve. */
export interface RouteHost {
	register(route: {
		kind: "exact" | "prefix";
		path: string;
		handler: (request: IncomingMessage, response: ServerResponse) => void;
	}): () => void;
}

/**
 * Build the request handler.
 * @param ctx - host context.
 * @param state - shared runtime state.
 * @param config - resolved configuration.
 */
export function createApiHandler(
	ctx: Context,
	state: RuntimeState,
	config: Config,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
	return async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");

		const send = (status: number, body: unknown): void => {
			response.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			});

			response.end(JSON.stringify(body));
		};

		try {
			if (
				url.pathname === `${ROUTE_PREFIX}/status` &&
				request.method === "GET"
			) {
				send(200, await auth.getStatus(ctx, state, config));
				return;
			}

			if (
				url.pathname === `${ROUTE_PREFIX}/login` &&
				request.method === "POST"
			) {
				// Start and answer immediately: the user finishes in a browser, and the
				// card follows `inFlight` until the attempt settles.
				void auth.signIn(ctx, state, config);
				await auth.settleNotice(300);

				send(202, await auth.getStatus(ctx, state, config));
				return;
			}

			if (
				url.pathname === `${ROUTE_PREFIX}/logout` &&
				request.method === "POST"
			) {
				await auth.signOut(ctx, state);

				send(200, await auth.getStatus(ctx, state, config));
				return;
			}

			if (
				url.pathname === `${ROUTE_PREFIX}/sync` &&
				request.method === "POST"
			) {
				await mcpBridge.ensure(ctx, state, config);

				send(200, await auth.getStatus(ctx, state, config));
				return;
			}

			send(404, { error: "not-found", path: url.pathname });
		} catch (error) {
			send(500, { error: errorText(error) });
		}
	};
}

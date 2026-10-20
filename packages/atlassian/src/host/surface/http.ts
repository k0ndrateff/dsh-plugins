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
import { errorText } from "dsh-mcp-oauth";
import type { AtlassianAuth } from "../auth";
import type { Config } from "../config";
import type { PanelApi } from "../panels/panel";
import type { RuntimeState } from "../state";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-atlassian";

/** Longest write body this route accepts, in bytes. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Read one small JSON request body.
 * @param request - the incoming request.
 * @returns the parsed body, or undefined when it is not a JSON object.
 */
async function readJson(
	request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;

		if (size > MAX_BODY_BYTES)
			throw new Error("request body is larger than this route accepts");
		chunks.push(buffer);
	}

	if (chunks.length === 0) return undefined;

	try {
		const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

		return parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** A request this route cannot act on, as opposed to a failure behind it. */
class BadRequest extends Error {}

/** One required string field of a request body. */
function required(
	body: Record<string, unknown> | undefined,
	name: string,
): string {
	const value = body?.[name];

	if (typeof value !== "string" || value === "")
		throw new BadRequest(`the request needs a "${name}"`);

	return value;
}

/** Mount a route the web server can serve. */
export interface RouteHost {
	register(route: {
		kind: "exact" | "prefix";
		path: string;
		handler: (request: IncomingMessage, response: ServerResponse) => void;
	}): () => void;
}

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly ctx: Context;
	readonly config: Config;
	readonly state: RuntimeState;
	readonly auth: AtlassianAuth;
	readonly panel: PanelApi;
}

/**
 * Build the request handler.
 * @param deps - the plugin's collaborators.
 */
export function createApiHandler(
	deps: ApiDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
	const { auth, panel } = deps;

	return async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const method = request.method ?? "GET";

		const send = (status: number, body: unknown): void => {
			response.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			});

			response.end(JSON.stringify(body));
		};

		/** Answer a read the settings card or the side panel asked for. */
		const sendData = async (load: () => Promise<unknown>): Promise<void> => {
			try {
				send(200, await load());
			} catch (error) {
				send(502, { error: errorText(error) });
			}
		};

		try {
			if (url.pathname === `${ROUTE_PREFIX}/status` && method === "GET") {
				send(200, await auth.getStatus());
				return;
			}

			if (url.pathname === `${ROUTE_PREFIX}/login` && method === "POST") {
				// Start and answer immediately: the user finishes in a browser, and the
				// card follows `inFlight` until the attempt settles.
				void auth.signIn();
				await auth.settleNotice(300);

				send(202, await auth.getStatus());
				return;
			}

			if (url.pathname === `${ROUTE_PREFIX}/logout` && method === "POST") {
				await auth.signOut();

				send(200, await auth.getStatus());
				return;
			}

			if (url.pathname === `${ROUTE_PREFIX}/sync` && method === "POST") {
				await auth.connect();

				send(200, await auth.getStatus());
				return;
			}

			// --- The side panel's reads -------------------------------------

			if (url.pathname === `${ROUTE_PREFIX}/issue` && method === "GET") {
				const key = url.searchParams.get("key") ?? "";
				await sendData(() => panel.issue(key));
				return;
			}

			if (url.pathname === `${ROUTE_PREFIX}/page` && method === "GET") {
				const id = url.searchParams.get("id") ?? "";
				await sendData(() => panel.page(id));
				return;
			}

			if (url.pathname === `${ROUTE_PREFIX}/people` && method === "GET") {
				const query = url.searchParams.get("q") ?? "";
				await sendData(() => panel.people(query));
				return;
			}

			// --- The side panel's writes ------------------------------------

			if (
				url.pathname === `${ROUTE_PREFIX}/issue/transition` &&
				method === "POST"
			) {
				// The request is read and validated before any work starts, so a
				// caller's mistake is answered as one instead of as a bad gateway.
				const body = await readJson(request);
				const key = required(body, "key");
				const transitionId = required(body, "transitionId");

				await sendData(async () => {
					await panel.transition(key, transitionId);

					return await panel.issue(key);
				});
				return;
			}

			if (
				url.pathname === `${ROUTE_PREFIX}/issue/assignee` &&
				method === "POST"
			) {
				const body = await readJson(request);
				const key = required(body, "key");
				const accountId = body?.accountId;

				if (accountId !== null && typeof accountId !== "string")
					throw new BadRequest('the request needs an "accountId" or null');

				await sendData(async () => {
					await panel.assign(key, accountId);

					return await panel.issue(key);
				});
				return;
			}

			send(404, { error: "not-found", path: url.pathname });
		} catch (error) {
			send(error instanceof BadRequest ? 400 : 500, {
				error: errorText(error),
			});
		}
	};
}

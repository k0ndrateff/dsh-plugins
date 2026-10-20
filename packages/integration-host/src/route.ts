/**
 * The localhost API a browser half calls.
 *
 * A settings card and a side panel live in the page, so they need a channel to
 * the host. A named route on the harness web server is that channel: it needs no
 * generated remote namespace, it is structured JSON in both directions, and it
 * is bound to loopback exactly like the rest of the web server.
 *
 * The four paths every integration answers — status, login, logout, sync — are
 * this module's; a provider adds its own reads and writes after them, and the
 * first handler that claims a request ends it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { errorText } from "dsh-mcp-oauth";
import type { IntegrationAuthFace } from "./auth";
import type { IntegrationStatus } from "./status";

/** Longest write body any integration's route accepts, in bytes. */
const MAX_BODY_BYTES = 8 * 1024;

/** Mount a route the web server can serve. */
export interface RouteHost {
	register(route: {
		kind: "exact" | "prefix";
		path: string;
		handler: (request: IncomingMessage, response: ServerResponse) => void;
	}): () => void;
}

/** One integration's route, as the shared mount takes it. */
export interface MountSpec {
	/** The route prefix this plugin owns, such as `/dsh-sentry`. */
	readonly prefix: string;
	/** The handler every request under that prefix reaches. */
	readonly handler: (
		request: IncomingMessage,
		response: ServerResponse,
	) => Promise<void>;
}

/**
 * Mount one integration's route on the harness web server.
 *
 * The registration waits for the web server rather than reading it once: the
 * loader mounts rows as their own dependencies resolve, so a plugin that merely
 * asks can run before the listener's fiber is active — and then its card never
 * reaches the host, which looks like a broken integration rather than a race. A
 * composition with no web server registers nothing, and the tools and the
 * command keep working.
 * @param ctx - the plugin's host context.
 * @param spec - the prefix this plugin owns and the handler under it.
 */
export function mountIntegrationRoute(ctx: Context, spec: MountSpec): void {
	ctx.inject(["webServer"], (scoped) => {
		const webServer = (scoped as { get: (name: string) => unknown }).get(
			"webServer",
		) as RouteHost;

		scoped.effect(
			() =>
				webServer.register({
					kind: "prefix",
					path: spec.prefix,
					handler: spec.handler,
				}),
			`${spec.prefix}: route`,
		);
	});
}

/** One request's parsed JSON body, and the fields it must carry. */
export interface RouteBody {
	/** The parsed object, or undefined when the request carried no body. */
	readonly fields: Record<string, unknown> | undefined;
	/**
	 * One required string field.
	 * @throws a bad-request failure, which the route answers with 400.
	 */
	required(name: string): string;
}

/** What one provider path handler reads and answers with. */
export interface RouteContext {
	readonly url: URL;
	readonly method: string;
	/** Read the request's JSON body; the read happens once. */
	read(): Promise<RouteBody>;
	/** Answer with JSON. */
	send(status: number, body: unknown): void;
	/**
	 * Answer with bytes and their media type.
	 *
	 * A panel that draws a picture needs the bytes themselves: an image cannot
	 * travel inside the JSON document that describes it.
	 */
	sendBytes(status: number, contentType: string, body: Uint8Array): void;
	/** Answer a read, translating a failure behind it into a bad gateway. */
	sendData(load: () => Promise<unknown>): Promise<void>;
}

/**
 * One provider path.
 * @returns whether this handler claimed the request.
 */
export type RouteHandler = (route: RouteContext) => Promise<boolean> | boolean;

/** Everything the route answers with, wired once at apply time. */
export interface RouteSpec<TStatus extends IntegrationStatus> {
	/** The route prefix this plugin owns, such as `/dsh-sentry`. */
	readonly prefix: string;
	readonly auth: IntegrationAuthFace<TStatus>;
	/** Provider paths, tried after the shared four, in order. */
	readonly routes?: readonly RouteHandler[];
}

/**
 * A request this route cannot act on, as opposed to a failure behind it.
 *
 * A provider path throws one of these for a caller's mistake, and the route
 * answers it with 400 rather than as a failure of the integration behind it.
 */
export class BadRequest extends Error {}

/** One body, read once and narrowed to the object shape every route expects. */
function bodyOf(value: Record<string, unknown> | undefined): RouteBody {
	return {
		fields: value,
		required: (name) => {
			const field = value?.[name];

			if (typeof field !== "string" || field === "")
				throw new BadRequest(`the request needs a "${name}"`);

			return field;
		},
	};
}

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

/**
 * Build the request handler for one integration.
 * @param spec - the route prefix, the sign-in face, and the provider's own paths.
 */
export function createIntegrationRoute<TStatus extends IntegrationStatus>(
	spec: RouteSpec<TStatus>,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
	const { prefix, auth } = spec;

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

		const sendBytes = (
			status: number,
			contentType: string,
			body: Uint8Array,
		): void => {
			response.writeHead(status, {
				"content-type": contentType,
				"content-length": body.byteLength,
				"cache-control": "no-store",
			});

			response.end(body);
		};

		/** Answer a read the settings card or the side panel asked for. */
		const sendData = async (load: () => Promise<unknown>): Promise<void> => {
			try {
				send(200, await load());
			} catch (error) {
				send(502, { error: errorText(error) });
			}
		};

		let body: Promise<RouteBody> | undefined;

		const context: RouteContext = {
			url,
			method,
			read: () => (body ??= readJson(request).then(bodyOf)),
			send,
			sendBytes,
			sendData,
		};

		try {
			if (url.pathname === `${prefix}/status` && method === "GET") {
				send(200, await auth.getStatus());
				return;
			}

			if (url.pathname === `${prefix}/login` && method === "POST") {
				// Start and answer immediately: the user finishes in a browser, and the
				// card follows `inFlight` until the attempt settles.
				void auth.signIn();
				await auth.settleNotice(300);

				send(202, await auth.getStatus());
				return;
			}

			if (url.pathname === `${prefix}/logout` && method === "POST") {
				await auth.signOut();

				send(200, await auth.getStatus());
				return;
			}

			if (url.pathname === `${prefix}/sync` && method === "POST") {
				await auth.connect();

				send(200, await auth.getStatus());
				return;
			}

			for (const handler of spec.routes ?? []) {
				if (await handler(context)) return;
			}

			send(404, { error: "not-found", path: url.pathname });
		} catch (error) {
			send(error instanceof BadRequest ? 400 : 500, {
				error: errorText(error),
			});
		}
	};
}

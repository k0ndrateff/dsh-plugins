/**
 * Offline checks for the bridge, against a server that speaks the protocol.
 *
 * The bridge is the half of the library that cannot be proved by a pure
 * function: it opens a transport, authenticates it, and publishes what the
 * server offers. A minimal streamable-HTTP MCP server stands in for a real one,
 * so the checks here need no network, no account, and no sign-in — and can see
 * the headers the bridge actually sent.
 *
 *   bun run test/bridge.ts
 */

import { expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {
	ToolDefinition,
	ToolExecution,
	ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { DEFAULT_INSTANCE } from "../src/account";
import { McpBridge } from "../src/bridge";
import { GrantStore } from "../src/grant";
import { errorText } from "../src/log";
import type { OAuthProviderProfile, ProviderProfile } from "../src/provider";

/** One JSON-RPC call the fake server answered, and how it was authenticated. */
interface SeenRequest {
	readonly method: string;
	readonly authorization: string | undefined;
}

/** The server the bridge is pointed at. */
interface FakeServer {
	readonly endpoint: string;
	readonly seen: SeenRequest[];
	close: () => Promise<void>;
}

/** What the fake server answers with. */
function resultFor(message: { method: string; id: number }): unknown {
	if (message.method === "initialize")
		return {
			protocolVersion: "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: { name: "fake", version: "1" },
		};

	if (message.method === "tools/list")
		return {
			tools: [
				{
					name: "ping",
					description: "Answer pong",
					inputSchema: { type: "object", properties: {} },
				},
			],
		};

	if (message.method === "tools/call")
		return { content: [{ type: "text", text: "pong" }] };

	return {};
}

/**
 * The documents discovery reads, so the fake server can be its own issuer.
 * @returns the document for a well-known path, or undefined for any other.
 */
function wellKnown(path: string, origin: string): unknown {
	if (path.startsWith("/.well-known/oauth-protected-resource"))
		return { resource: `${origin}/mcp`, authorization_servers: [origin] };

	if (path.startsWith("/.well-known/oauth-authorization-server"))
		return {
			issuer: origin,
			authorization_endpoint: `${origin}/authorize`,
			token_endpoint: `${origin}/token`,
			token_endpoint_auth_methods_supported: ["none"],
		};

	return undefined;
}

/** A minimal MCP server: initialize, tools/list, tools/call, nothing else. */
async function startFakeServer(): Promise<FakeServer> {
	const seen: SeenRequest[] = [];

	const server: Server = createServer((request, response) => {
		let body = "";

		request.on("data", (chunk: string) => {
			body += chunk;
		});

		request.on("end", () => {
			const url = new URL(
				request.url ?? "/",
				`http://${request.headers.host ?? "127.0.0.1"}`,
			);
			const document =
				request.method === "GET"
					? wellKnown(url.pathname, url.origin)
					: undefined;

			if (document !== undefined) {
				response
					.writeHead(200, { "content-type": "application/json" })
					.end(JSON.stringify(document));

				return;
			}

			const message =
				body === ""
					? undefined
					: (JSON.parse(body) as {
							id?: number;
							method?: string;
						});

			if (message?.method !== undefined && message.id !== undefined)
				seen.push({
					method: message.method,
					authorization: request.headers.authorization,
				});

			if (message === undefined || message.id === undefined) {
				response.writeHead(202).end();

				return;
			}

			response
				.writeHead(200, {
					"content-type": "application/json",
					"mcp-session-id": "fake-session",
				})
				.end(
					JSON.stringify({
						jsonrpc: "2.0",
						id: message.id,
						result: resultFor({ method: message.method ?? "", id: message.id }),
					}),
				);
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;

	return {
		endpoint: `http://127.0.0.1:${port}/mcp`,
		seen,
		close: async () => {
			server.closeAllConnections();

			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		},
	};
}

/**
 * A server that refuses every request, as a provider does when the resource is
 * not switched on for the account.
 */
async function startRefusingServer(): Promise<FakeServer> {
	const server: Server = createServer((_request, response) => {
		response
			.writeHead(403, { "content-type": "application/json" })
			.end(
				JSON.stringify({ message: "403 Forbidden - MCP server not enabled" }),
			);
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;

	return {
		endpoint: `http://127.0.0.1:${port}/mcp`,
		seen: [],
		close: async () => {
			server.closeAllConnections();

			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		},
	};
}

/** A harness context with just enough surface for the bridge and its store. */
function harness(records: Map<string, unknown>): {
	ctx: Context;
	published: string[];
	definitions: Map<string, ToolDefinition>;
} {
	const published: string[] = [];
	const definitions = new Map<string, ToolDefinition>();
	const active = new Set<string>();

	return {
		published,
		definitions,
		ctx: {
			logger: { info: () => {}, warn: () => {} },
			tools: {
				register: (definition: ToolDefinition) => {
					if (active.has(definition.name))
						throw new Error(`tool "${definition.name}" is already registered`);

					active.add(definition.name);
					published.push(definition.name);
					definitions.set(definition.name, definition);

					return () => {
						active.delete(definition.name);
					};
				},
			},
			credentials: {
				readRecord: async (key: string) => records.get(key),
				modifyRecord: async () => undefined,
				deleteRecord: async () => {},
			},
		} as unknown as Context,
	};
}

/** A record with the given access token, valid for an hour. */
function grant(token: string | undefined): { kind: "grant"; payload: unknown } {
	return {
		kind: "grant",
		payload: {
			version: 1,
			clientId: "client",
			accessToken: token,
			expiresAt: Date.now() + 3_600_000,
		},
	};
}

/** A profile of a server that needs no credentials. */
function localProfile(endpoint: string): ProviderProfile {
	return {
		scope: "dsh-local",
		label: "Local",
		instance: DEFAULT_INSTANCE,
		endpoint,
		toolNamespace: "local",
		debug: false,
	};
}

/** A profile of a server reached through OAuth. */
function oauthProfile(endpoint: string): OAuthProviderProfile {
	return {
		...localProfile(endpoint),
		scope: "dsh-remote",
		label: "Remote",
		toolNamespace: "remote",
		oauth: {
			redirectPort: 8143,
			scopes: ["mcp"],
			fallbackScopes: ["mcp"],
			clientName: "DeepSeek Harness",
		},
	};
}

const CLIENT_INFO = { name: "dsh-mcp-oauth", version: "0.1.0" };

const server = await startFakeServer();
const key = "dsh-remote/mcp";
const records = new Map<string, unknown>([[key, grant("token-one")]]);
const { ctx, published, definitions } = harness(records);

test("a server that needs no credentials", async () => {
	const local = new McpBridge({
		profile: localProfile(server.endpoint),
		clientInfo: CLIENT_INFO,
	});

	expect((await local.ensure(ctx)) === true, "the bridge connects").toBe(true);
	expect(
		local.toolNames.join() === "mcp__local__ping",
		`the server's tools are published under the plugin's namespace — ${local.toolNames.join()}`,
	).toBe(true);
	expect(
		server.seen.length > 0 &&
			server.seen.every((request) => request.authorization === undefined),
		`the connection was made without an Authorization header — ${String(server.seen[0]?.authorization)}`,
	).toBe(true);
	expect(local.isConnected, "the bridge reports itself connected").toBe(true);
	expect(
		published.join() === "mcp__local__ping",
		"the published tools are the ones registered",
	).toBe(true);

	const ping = definitions.get("mcp__local__ping");
	const long = "x".repeat(60_000);
	const capped = ping?.finalizeContent?.(
		{} as ToolExecution,
		{
			content: [{ type: "text", text: long }],
			isError: false,
		} as ToolExecutionResult,
	);
	const cappedText = (capped?.[0] as { text?: string } | undefined)?.text ?? "";

	expect(
		cappedText.length > 0 &&
			cappedText.length < long.length &&
			cappedText.includes("cut at"),
		`a model-facing MCP answer is cut and says so — ${String(cappedText.length)}`,
	).toBe(true);

	await local.drop();
});
test("a server reached through OAuth", async () => {
	const remote = new McpBridge({
		profile: oauthProfile(server.endpoint),
		store: new GrantStore(ctx, key),
		clientInfo: CLIENT_INFO,
	});

	const beforeConnect = server.seen.length;

	expect(
		(await remote.ensure(ctx)) === true,
		"a signed-in account connects",
	).toBe(true);
	expect(
		server.seen
			.slice(beforeConnect)
			.some((request) => request.authorization === "Bearer token-one"),
		`the stored access token is sent as a bearer token — ${server.seen.at(-1)?.authorization}`,
	).toBe(true);

	records.set(key, grant("token-two"));

	const beforeRotation = server.seen.length;

	expect(
		(await remote.ensure(ctx)) === true,
		"a reconnect with a rotated token succeeds",
	).toBe(true);
	expect(
		server.seen
			.slice(beforeRotation)
			.some((request) => request.authorization === "Bearer token-two"),
		`the new token is used without a reconnect — ${server.seen.at(-1)?.authorization}`,
	).toBe(true);

	const called = await remote.callTool("ping", {});

	expect(
		JSON.stringify(called.content).includes("pong"),
		`a tool call reaches the server — ${JSON.stringify(called.content)}`,
	).toBe(true);

	await remote.drop();
});
test("an account that is not signed in", async () => {
	const empty = new McpBridge({
		profile: oauthProfile(server.endpoint),
		store: new GrantStore(ctx, "dsh-remote/mcp-work"),
		clientInfo: CLIENT_INFO,
	});

	const beforeEmpty = server.seen.length;

	expect(
		(await empty.ensure(ctx)) === false,
		"a bridge without a grant is not usable",
	).toBe(true);
	expect(
		server.seen.length === beforeEmpty,
		`it never reaches the server — ${String(server.seen.length - beforeEmpty)}`,
	).toBe(true);

	let refused = "";
	try {
		new McpBridge({
			profile: oauthProfile(server.endpoint),
			clientInfo: CLIENT_INFO,
		});
	} catch (error) {
		refused = errorText(error);
	}

	expect(
		refused !== "",
		"an OAuth profile without a grant store is refused at construction",
	).toBe(true);
});
test("a server that refuses the connection", async () => {
	const refusing = await startRefusingServer();
	const blocked = new McpBridge({
		profile: localProfile(refusing.endpoint),
		clientInfo: CLIENT_INFO,
	});

	expect(
		(await blocked.ensure(ctx)) === false,
		"a refused connection is not usable",
	).toBe(true);
	expect(
		blocked.lastFailure?.includes("403 Forbidden") === true,
		`the reason the server gave is kept for the settings card — ${String(blocked.lastFailure)}`,
	).toBe(true);
	await refusing.close();
	await server.close();
});

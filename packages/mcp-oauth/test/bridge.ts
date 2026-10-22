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

import { createServer, type Server } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { DEFAULT_INSTANCE } from "../src/account";
import { McpBridge } from "../src/bridge";
import { GrantStore } from "../src/grant";
import { errorText } from "../src/log";
import type { OAuthProviderProfile, ProviderProfile } from "../src/provider";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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
} {
	const published: string[] = [];
	const active = new Set<string>();

	return {
		published,
		ctx: {
			logger: { info: () => {}, warn: () => {} },
			tools: {
				register: (definition: { name: string }) => {
					if (active.has(definition.name))
						throw new Error(`tool "${definition.name}" is already registered`);

					active.add(definition.name);
					published.push(definition.name);

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
const { ctx, published } = harness(records);

console.log("\n=== a server that needs no credentials ===");

const local = new McpBridge({
	profile: localProfile(server.endpoint),
	clientInfo: CLIENT_INFO,
});

check("the bridge connects", (await local.ensure(ctx)) === true);
check(
	"the server's tools are published under the plugin's namespace",
	local.toolNames.join() === "mcp__local__ping",
	local.toolNames.join(),
);
check(
	"the connection was made without an Authorization header",
	server.seen.length > 0 &&
		server.seen.every((request) => request.authorization === undefined),
	String(server.seen[0]?.authorization),
);
check("the bridge reports itself connected", local.isConnected);
check(
	"the published tools are the ones registered",
	published.join() === "mcp__local__ping",
);

await local.drop();

console.log("\n=== a server reached through OAuth ===");

const remote = new McpBridge({
	profile: oauthProfile(server.endpoint),
	store: new GrantStore(ctx, key),
	clientInfo: CLIENT_INFO,
});

const beforeConnect = server.seen.length;

check("a signed-in account connects", (await remote.ensure(ctx)) === true);
check(
	"the stored access token is sent as a bearer token",
	server.seen
		.slice(beforeConnect)
		.some((request) => request.authorization === "Bearer token-one"),
	server.seen.at(-1)?.authorization,
);

records.set(key, grant("token-two"));

const beforeRotation = server.seen.length;

check(
	"a reconnect with a rotated token succeeds",
	(await remote.ensure(ctx)) === true,
);
check(
	"the new token is used without a reconnect",
	server.seen
		.slice(beforeRotation)
		.some((request) => request.authorization === "Bearer token-two"),
	server.seen.at(-1)?.authorization,
);

const called = await remote.callTool("ping", {});

check(
	"a tool call reaches the server",
	JSON.stringify(called.content).includes("pong"),
	JSON.stringify(called.content),
);

await remote.drop();

console.log("\n=== an account that is not signed in ===");

const empty = new McpBridge({
	profile: oauthProfile(server.endpoint),
	store: new GrantStore(ctx, "dsh-remote/mcp-work"),
	clientInfo: CLIENT_INFO,
});

const beforeEmpty = server.seen.length;

check(
	"a bridge without a grant is not usable",
	(await empty.ensure(ctx)) === false,
);
check(
	"it never reaches the server",
	server.seen.length === beforeEmpty,
	String(server.seen.length - beforeEmpty),
);

let refused = "";
try {
	new McpBridge({
		profile: oauthProfile(server.endpoint),
		clientInfo: CLIENT_INFO,
	});
} catch (error) {
	refused = errorText(error);
}

check(
	"an OAuth profile without a grant store is refused at construction",
	refused !== "",
);

console.log("\n=== a server that refuses the connection ===");

const refusing = await startRefusingServer();
const blocked = new McpBridge({
	profile: localProfile(refusing.endpoint),
	clientInfo: CLIENT_INFO,
});

check(
	"a refused connection is not usable",
	(await blocked.ensure(ctx)) === false,
);
check(
	"the reason the server gave is kept for the settings card",
	blocked.lastFailure?.includes("403 Forbidden") === true,
	String(blocked.lastFailure),
);
check(
	"a bridge that never failed has no reason to show",
	local.lastFailure === undefined && remote.lastFailure === undefined,
);

await refusing.close();
await server.close();

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

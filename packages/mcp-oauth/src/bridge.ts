/**
 * The bridge to one OAuth-protected remote MCP server.
 *
 * The stock MCP client takes its HTTP headers from static configuration, and an
 * OAuth access token changes over the life of the process. So the transport is
 * built here with an `authProvider` that is asked for the token before every
 * request — a refresh therefore needs no reconnect — and each discovered tool is
 * published through the harness's own MCP adapter, so results keep the canonical
 * shape.
 *
 * The bridge owns its connection: the client, the published tools, and the
 * authorization server it discovered. A caller that wants provider-specific
 * work done at connect time passes {@link McpBridgeOptions.onConnected}.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type {
	CallToolResult,
	Client,
	Tool,
} from "@modelcontextprotocol/client";
import { discover } from "./discovery";
import type { GrantStore } from "./grant";
import { errorText, loggerOf } from "./log";
import type { ProviderProfile } from "./provider";
import type { OAuthServer } from "./server";
import { publicToolName } from "./tool-name";

/** How long one MCP tool call may take. */
const TOOL_CALL_TIMEOUT_MS = 60_000;

export interface McpBridgeOptions {
	/** The provider whose server this bridge talks to. */
	readonly profile: ProviderProfile;
	/** The record the access token is read and refreshed through. */
	readonly store: GrantStore;
	/** How the server sees this client; some gate capabilities on the name. */
	readonly clientInfo: { readonly name: string; readonly version: string };
	/** Called once per discovered tool, before it is registered. */
	readonly decorate?: (
		definition: ToolDefinition,
		tool: Tool,
	) => ToolDefinition;
	/** Called after a successful connect, for provider-specific learning. */
	readonly onConnected?: () => Promise<void>;
}

export class McpOAuthBridge {
	private client: Client | undefined;
	private oauth: OAuthServer | undefined;
	private disposers = new Map<string, () => void>();
	private names: string[] = [];
	private ready = false;

	constructor(private readonly options: McpBridgeOptions) {}

	/** Public names of the published tools, in discovery order. */
	get toolNames(): readonly string[] {
		return this.names;
	}

	/** Whether the connection is currently usable. */
	get isConnected(): boolean {
		return this.ready;
	}

	/**
	 * Connect and publish tools when the user is signed in.
	 * @param ctx - host context, for logging.
	 * @returns whether the bridge is usable; failures are logged, never thrown.
	 */
	async ensure(ctx: Context): Promise<boolean> {
		const grant = await this.options.store.read();

		if (grant === undefined || !grant.isSignedIn()) return false;

		try {
			const oauth = this.oauth ?? (await discover(this.options.profile));
			this.oauth = oauth;

			if (this.client === undefined) await this.connect(oauth);

			await this.publishTools(ctx);
			await this.options.onConnected?.();

			loggerOf(ctx).info(
				"[%s] %d tools available from %s",
				this.options.profile.id,
				this.names.length,
				this.options.profile.endpoint,
			);

			return true;
		} catch (error) {
			this.ready = false;

			await this.drop();
			loggerOf(ctx).warn(
				"[%s] MCP bridge unavailable: %s",
				this.options.profile.id,
				errorText(error),
			);

			return false;
		}
	}

	/** Close the connection and withdraw every published tool. */
	async drop(): Promise<void> {
		for (const dispose of this.disposers.values()) dispose();

		this.disposers = new Map();
		this.names = [];
		this.ready = false;

		const client = this.client;
		this.client = undefined;

		if (client !== undefined) await client.close().catch(() => undefined);
	}

	/**
	 * Call one tool of the connected server by its own name.
	 * @param name - the server's tool name, without any published prefix.
	 * @param args - tool arguments.
	 * @throws when the connection is not open.
	 */
	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const client = this.client;

		if (client === undefined)
			throw new Error(
				`the ${this.options.profile.label} MCP connection is not open`,
			);

		return await client.callTool(
			{ name, arguments: args },
			{ timeout: TOOL_CALL_TIMEOUT_MS },
		);
	}

	/** Open the MCP connection over an authenticated transport. */
	private async connect(oauth: OAuthServer): Promise<void> {
		const { Client: McpClient, StreamableHTTPClientTransport } = await import(
			"@modelcontextprotocol/client"
		);

		const store = this.options.store;

		const transport = new StreamableHTTPClientTransport(
			new URL(oauth.resource),
			{
				authProvider: {
					// Asked for before every request, so a refreshed token needs no reconnect.
					token: async () => await store.accessToken(oauth),
					onUnauthorized: async () => {
						await store.refresh(oauth);
					},
				},
			},
		);

		const client = new McpClient(this.options.clientInfo, { capabilities: {} });
		await client.connect(transport);

		this.client = client;
		this.ready = true;
	}

	/** Publish every server tool, replacing the previous generation. */
	private async publishTools(ctx: Context): Promise<string[]> {
		const client = this.client;

		if (client === undefined) throw new Error("the MCP connection is not open");

		const { createMcpToolDefinition } = await import(
			"@deepseek-ai/dsh-mcp-client"
		);

		const listed = await client.listTools(undefined, { cacheMode: "refresh" });
		const disposers = new Map<string, () => void>();
		const names: string[] = [];

		for (const tool of listed.tools) {
			const name = publicToolName(
				tool.name,
				this.options.profile.toolNamespace,
			);
			const base = createMcpToolDefinition(ctx, {
				name,
				rawName: tool.name,
				description: tool.description ?? `MCP tool ${tool.name}`,
				inputSchema: (tool.inputSchema ?? {
					type: "object",
					properties: {},
				}) as Record<string, unknown>,
				...(tool.outputSchema === undefined
					? {}
					: { outputSchema: tool.outputSchema }),
				...(tool.execution?.taskSupport === "required"
					? { taskRequired: true }
					: {}),
				call: async (args, execution) =>
					await client.callTool(
						{ name: tool.name, arguments: args },
						{
							signal: execution.signal,
							toolDefinition: tool as Tool,
							timeout: TOOL_CALL_TIMEOUT_MS,
						},
					),
			});

			disposers.set(
				name,
				ctx.tools.register(this.options.decorate?.(base, tool as Tool) ?? base),
			);
			names.push(name);
		}

		for (const dispose of this.disposers.values()) dispose();

		this.disposers = disposers;
		this.names = names;

		return names;
	}
}

/**
 * The bridge to Atlassian's remote MCP server.
 *
 * The stock `dsh-mcp-client` cannot carry this connection: its HTTP headers are
 * static configuration, while an OAuth access token changes over the life of
 * the process. So the transport is built here with an `authProvider` that is
 * asked for the token before every request — a refresh therefore needs no
 * reconnect — and each discovered tool is published through the harness's own
 * MCP adapter so results keep the canonical MCP shape.
 *
 * Both the SDK and the adapter are imported dynamically: a resolution failure
 * must degrade to "no Atlassian tools" with a clear log, not stop the plugin
 * from loading and taking the settings card with it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {
	CallToolResult,
	Client,
	Tool,
} from "@modelcontextprotocol/client";
import { publicToolName } from "../../shared/tool-names";
import type { Config } from "../config";
import { errorText, loggerOf } from "../log";
import { oauthDiscovery } from "../oauth/discovery";
import type { OAuthServer } from "../oauth/server";
import { extractor } from "../presentation/extract";
import type { RuntimeState } from "../state";
import { Grant } from "../store/grant";

class McpBridge {
	/** The name Atlassian sees in `clientInfo`. */
	private readonly CLIENT_INFO = { name: "dsh-atlassian", version: "0.2.0" };
	private readonly TOOL_CALL_TIMEOUT_MS = 60_000;
	private readonly SITE_TOOL = "getAccessibleAtlassianResources";

	/**
	 * Connect and publish tools when the user is signed in.
	 * @returns whether the bridge is usable; failures are logged, never thrown.
	 */
	ensure = async (
		ctx: Context,
		state: RuntimeState,
		config: Config,
	): Promise<boolean> => {
		const grant = await Grant.read(ctx);

		if (grant === undefined || typeof grant.accessToken !== "string")
			return false;

		if (typeof grant.siteUrl === "string") state.siteUrl = grant.siteUrl;

		if (typeof grant.cloudId === "string") state.cloudId = grant.cloudId;

		try {
			const oauth =
				state.oauth ?? (await oauthDiscovery.discover(config.endpoint));
			state.oauth = oauth;

			if (state.client === undefined) await this.connect(ctx, state, oauth);

			await this.publishTools(ctx, state);
			await this.learnSite(ctx, state);

			loggerOf(ctx).info(
				"[atlassian] %d tools available from %s",
				state.toolNames.length,
				config.endpoint,
			);

			return true;
		} catch (error) {
			state.connected = false;

			await this.drop(state);
			loggerOf(ctx).warn(
				"[atlassian] MCP bridge unavailable: %s",
				errorText(error),
			);

			return false;
		}
	};

	/** Close the connection and withdraw every published tool. */
	drop = async (state: RuntimeState): Promise<void> => {
		for (const dispose of state.tools.values()) dispose();

		state.tools = new Map();
		state.toolNames = [];
		state.connected = false;
		const client: Client | undefined = state.client;
		state.client = undefined;

		if (client !== undefined) await client.close().catch(() => undefined);
	};

	/**
	 * Call one tool of the connected server by its own name.
	 *
	 * The presentation tool uses this to resolve what it was asked to show; the
	 * published tool wrappers go through the same path, so both see identical
	 * results.
	 * @param state - runtime state holding the connection.
	 * @param name - the server's tool name, without the published prefix.
	 * @param args - tool arguments.
	 * @returns the canonical MCP result.
	 */
	callTool = async (
		state: RuntimeState,
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> => {
		const client = state.client;

		if (client === undefined)
			throw new Error("the Atlassian MCP connection is not open");

		return await client.callTool(
			{ name, arguments: args },
			{ timeout: this.TOOL_CALL_TIMEOUT_MS },
		);
	};

	/** Open the MCP connection, or replace the existing one. */
	private connect = async (
		ctx: Context,
		state: RuntimeState,
		oauth: OAuthServer,
	): Promise<void> => {
		const { Client: McpClient, StreamableHTTPClientTransport } = await import(
			"@modelcontextprotocol/client"
		);

		const transport = new StreamableHTTPClientTransport(
			new URL(oauth.resource),
			{
				authProvider: {
					// Asked for before every request, so a refreshed token needs no reconnect.
					token: async () => await Grant.accessToken(ctx, oauth),
					onUnauthorized: async () => {
						await Grant.refreshAccessToken(ctx, oauth);
					},
				},
			},
		);

		const client = new McpClient(this.CLIENT_INFO, { capabilities: {} });
		await client.connect(transport);

		state.client = client;
		state.connected = true;
	};

	/** Publish every server tool, replacing the previous generation. */
	private publishTools = async (
		ctx: Context,
		state: RuntimeState,
	): Promise<string[]> => {
		const client = state.client;

		if (client === undefined)
			throw new Error("the Atlassian MCP connection is not open");

		const { createMcpToolDefinition } = await import(
			"@deepseek-ai/dsh-mcp-client"
		);

		const listed = await client.listTools(undefined, { cacheMode: "refresh" });
		const disposers = new Map<string, () => void>();
		const names: string[] = [];

		for (const tool of listed.tools) {
			const name = publicToolName(tool.name);
			const base = createMcpToolDefinition(ctx, {
				name,
				rawName: tool.name,
				description: tool.description ?? `Atlassian tool ${tool.name}`,
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
							timeout: this.TOOL_CALL_TIMEOUT_MS,
						},
					),
			});

			disposers.set(
				name,
				ctx.tools.register({
					...base,
					output: {
						...base.output,
						// The durable UI channel: the Web Client reads this back as `result.meta`.
						presentationMeta: (args, value) =>
							extractor.extract({
								tool: tool.name,
								args,
								value,
								siteUrl: state.siteUrl,
							}),
					},
				}),
			);
			names.push(name);
		}

		for (const dispose of state.tools.values()) dispose();

		state.tools = disposers;
		state.toolNames = names;

		return names;
	};

	/**
	 * Learn the site once: its browser URL and the cloud id every tool needs.
	 *
	 * Atlassian withholds `webUrl` from clients it does not recognize by name, so
	 * the account's own list of sites is what lets a card link to an issue — and
	 * its `id` is what every Jira and Confluence tool call must carry.
	 */
	private learnSite = async (
		ctx: Context,
		state: RuntimeState,
	): Promise<void> => {
		const client = state.client;

		if (
			client === undefined ||
			(state.siteUrl !== undefined && state.cloudId !== undefined)
		)
			return;

		const available = state.toolNames.some((name) =>
			name.endsWith(this.SITE_TOOL),
		);

		if (!available) return;

		try {
			const result = await client.callTool(
				{ name: this.SITE_TOOL, arguments: {} },
				{ timeout: this.TOOL_CALL_TIMEOUT_MS },
			);

			const text = (result.content ?? [])
				.filter((block) => block.type === "text")
				.map((block) => ("text" in block ? block.text : ""))
				.join("\n");

			const sites: unknown = JSON.parse(text);
			const first = Array.isArray(sites) ? sites[0] : undefined;
			const record =
				first !== null && typeof first === "object"
					? (first as { url?: unknown; id?: unknown })
					: undefined;

			const url = typeof record?.url === "string" ? record.url : undefined;
			const cloudId = typeof record?.id === "string" ? record.id : undefined;

			if (url !== undefined && url !== "")
				state.siteUrl = url.replace(/\/+$/u, "");
			if (cloudId !== undefined && cloudId !== "") state.cloudId = cloudId;

			await Grant.mutate(ctx, async (grant) =>
				grant === undefined
					? undefined
					: new Grant({
							...grant,
							...(state.siteUrl === undefined
								? {}
								: { siteUrl: state.siteUrl }),
							...(state.cloudId === undefined
								? {}
								: { cloudId: state.cloudId }),
						}),
			);
		} catch (error) {
			loggerOf(ctx).warn(
				"[atlassian] could not read the site URL: %s",
				errorText(error),
			);
		}
	};
}

export const mcpBridge = new McpBridge();

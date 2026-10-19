/**
 * dsh-atlassian — Jira and Confluence for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half owns the OAuth flow, the credential
 * record, and the bridge to Atlassian's remote MCP server, while `lib/client.js`
 * contributes the settings card and the result cards to the Web Client.
 *
 * Sign-in needs no Atlassian app registration: the MCP resource's own metadata
 * names an authorization server that supports dynamic client registration, so
 * the plugin registers itself as a public client the first time a user signs in.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools`,
// `ctx.credentials`, `ctx.authorization`, and `ctx.commands` are declared by
// the packages that own them, not by cordis itself.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-tools";
import { type ConfigInput, resolveConfig } from "./config";
import { loggerOf } from "./log";
import { mcpBridge } from "./mcp/bridge";
import { oauthFlow } from "./oauth/flow";
import { RuntimeState } from "./state";
import { Grant } from "./store/grant";
import { commandHandler } from "./surface/command";
import { createApiHandler, ROUTE_PREFIX, type RouteHost } from "./surface/http";
import { presentTool } from "./tools/present";

export const name = "dsh-atlassian";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "credentials", "commands", "authorization"];

/** The seam's method id for the browser-based flow. */
const OAUTH_METHOD = "oauth";

/**
 * @param ctx - host context carrying tools, credentials, commands, and authorization.
 * @param configInput - `endpoint`, `redirectPort`, and `debug` from the bundle patch.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const state = new RuntimeState();
	const logger = loggerOf(ctx);

	// Registering the flow tells the harness this credential can be authorized,
	// and routes each attempt's notices to whoever started it.
	const disposeFlow = ctx.authorization.registerFlow({
		key: Grant.CREDENTIAL_KEY,
		label: "Atlassian",
		methods: [{ id: OAUTH_METHOD, label: "Sign in with Atlassian" }],
		run: async (session) => {
			await oauthFlow.run(ctx, session, config);
		},
	});

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin; only the resources that outlive a plain
	// registration need an explicit disposer.
	ctx.commands.register({
		name: commandHandler.COMMAND_NAME,
		description: "Jira and Confluence: status | login | logout | sync",
		input: { hint: "status | login | logout | sync" },
		handler: commandHandler.create(ctx, state, config),
	});

	// The presentation tool is registered beside the MCP tools it resolves
	// through: it shows what they return as a card under the agent's answer.
	ctx.tools.register(presentTool.create(ctx, state));

	// The card's channel to the host: a named route is how a plugin serves the
	// page without a generated remote namespace.
	const webServer = (ctx as { get?: (name: string) => unknown }).get?.(
		"webServer",
	) as RouteHost | undefined;

	const disposeRoute = webServer?.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: createApiHandler(ctx, state, config),
	});

	if (disposeRoute === undefined) {
		logger.warn(
			"[atlassian] no web server route; the settings card cannot reach the host",
		);
	}

	ctx.effect(
		() => () => {
			disposeRoute?.();
			disposeFlow();
			// Closing the MCP connection also withdraws every published Atlassian tool.
			return mcpBridge.drop(state);
		},
		"atlassian: flow, route and MCP bridge",
	);

	// A signed-in user gets tools without a restart. A fresh install stays dormant
	// until someone runs `/atlassian login` or uses the settings card.
	void mcpBridge.ensure(ctx, state, config).then((ready) => {
		if (!ready) {
			logger.info(
				"[atlassian] not signed in yet — use the Atlassian settings card or /atlassian login",
			);
		}
	});
}

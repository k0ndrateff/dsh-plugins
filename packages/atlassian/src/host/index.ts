/**
 * dsh-atlassian — Jira and Confluence for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half owns what is Atlassian's — the site
 * facts, the card extractor, the panel data, the `/atlassian` command, and the
 * settings route — while `dsh-mcp-oauth` owns the OAuth flow, the credential
 * record, and the bridge to Atlassian's remote MCP server. `lib/client.js`
 * contributes the settings card, the result cards, and the side panel to the
 * Web Client.
 *
 * This module is the composition root: it builds one of each collaborator and
 * hands them to the surfaces that need them.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools`,
// `ctx.credentials`, `ctx.authorization`, and `ctx.commands` are declared by
// the packages that own them, not by cordis itself.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-tools";
import {
	AuthorizationFlow,
	GrantStore,
	loggerOf,
	McpOAuthBridge,
} from "dsh-mcp-oauth";
import { AtlassianAuth } from "./auth";
import { atlassianProfile, type ConfigInput, resolveConfig } from "./config";
import { PanelApi } from "./panels/panel";
import { extractor } from "./presentation/extract";
import { RuntimeState } from "./state";
import { commandHandler } from "./surface/command";
import { createApiHandler, ROUTE_PREFIX, type RouteHost } from "./surface/http";
import { presentTool } from "./tools/present";

export const name = "dsh-atlassian";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "credentials", "commands", "authorization"];

/** The seam's method id for the browser-based flow. */
const OAUTH_METHOD = "oauth";

/** How Atlassian's server sees this client; it gates payload detail on the name. */
const CLIENT_INFO = { name: "dsh-atlassian", version: "0.3.0" };

/**
 * @param ctx - host context carrying tools, credentials, commands, and authorization.
 * @param configInput - `endpoint`, `redirectPort`, and `debug` from the bundle patch.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const profile = atlassianProfile(config);
	const state = new RuntimeState();
	const logger = loggerOf(ctx);

	const store = new GrantStore(ctx, profile.credentialKey);
	const flow = new AuthorizationFlow(profile, store);
	const bridge = new McpOAuthBridge({
		profile,
		store,
		clientInfo: CLIENT_INFO,
		// The durable UI channel: the Web Client reads this back as `result.meta`.
		decorate: (definition, tool) => ({
			...definition,
			output: {
				...definition.output,
				presentationMeta: (args, value) =>
					extractor.extract({
						tool: tool.name,
						args,
						value,
						siteUrl: state.siteUrl,
					}),
			},
		}),
	});
	const auth = new AtlassianAuth({ ctx, config, state, store, flow, bridge });
	const panel = new PanelApi({ bridge, state });

	// Registering the flow tells the harness this credential can be authorized,
	// and routes each attempt's notices to whoever started it.
	const disposeFlow = ctx.authorization.registerFlow({
		key: store.credentialKey,
		label: "Atlassian",
		methods: [{ id: OAUTH_METHOD, label: "Sign in with Atlassian" }],
		run: async (session) => {
			await flow.run(ctx, session);
		},
	});

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin; only the resources that outlive a plain
	// registration need an explicit disposer.
	ctx.commands.register({
		name: commandHandler.COMMAND_NAME,
		description: "Jira and Confluence: status | login | logout | sync",
		input: { hint: "status | login | logout | sync" },
		handler: commandHandler.create(auth),
	});

	// The presentation tool is registered beside the MCP tools it resolves
	// through: it shows what they return as a card under the agent's answer.
	ctx.tools.register(presentTool.create({ ctx, bridge, state }));

	// The card's channel to the host: a named route is how a plugin serves the
	// page without a generated remote namespace.
	const webServer = (ctx as { get?: (name: string) => unknown }).get?.(
		"webServer",
	) as RouteHost | undefined;

	const disposeRoute = webServer?.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: createApiHandler({ ctx, config, state, auth, panel }),
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
			return bridge.drop();
		},
		"atlassian: flow, route and MCP bridge",
	);

	// A signed-in user gets tools without a restart. A fresh install stays dormant
	// until someone runs `/atlassian login` or uses the settings card.
	void auth.connect().then((ready) => {
		if (!ready) {
			logger.info(
				"[atlassian] not signed in yet — use the Atlassian settings card or /atlassian login",
			);
		}
	});
}

/**
 * dsh-sentry — Sentry for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half owns what is Sentry's — the
 * organization facts, the panel data, the card extractor, and the `/sentry`
 * command's own wording — while `dsh-mcp-oauth` owns the OAuth flow and the
 * bridge to Sentry's remote MCP server, and `dsh-integration-host` owns the
 * shell every integration shares. `lib/client.js` contributes the settings
 * card, the result cards, and the side panel to the Web Client.
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
	IntegrationAuth,
	type IntegrationAuthFace,
	mountIntegrationRoute,
	RuntimeState,
} from "dsh-integration-host";
import {
	AuthorizationFlow,
	credentialKeyOf,
	GrantStore,
	loggerOf,
	McpBridge,
} from "dsh-mcp-oauth";
import type { SentryStatus } from "../shared/status";
import { sentryAuthSpec } from "./auth";
import {
	type ConfigInput,
	PLUGIN_NAME,
	resolveConfig,
	sentryProfile,
} from "./config";
import { registerCorrelationSource } from "./correlation";
import { registerDigestSource } from "./digest";
import { PanelApi } from "./panels/panel";
import type { OrganizationFacts } from "./store/organization";
import { COMMAND_NAME, createCommandHandler } from "./surface/command";
import { createApiHandler, ROUTE_PREFIX } from "./surface/http";
import { presentTool } from "./tools/present";

export const name = PLUGIN_NAME;

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "credentials", "commands", "authorization"];

/** The seam's method id for the browser-based flow. */
const OAUTH_METHOD = "oauth";

/** How Sentry's server sees this client. */
const CLIENT_INFO = { name: "dsh-sentry", version: "0.1.0" };

/**
 * @param ctx - host context carrying tools, credentials, commands, and authorization.
 * @param configInput - `endpoint`, `redirectPort`, and `debug` from the bundle patch.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const profile = sentryProfile(config);
	const state = new RuntimeState<OrganizationFacts>();
	const logger = loggerOf(ctx);

	const store = new GrantStore(ctx, credentialKeyOf(profile));
	const flow = new AuthorizationFlow(profile, store);
	const bridge = new McpBridge({
		profile,
		store,
		clientInfo: CLIENT_INFO,
	});
	const auth: IntegrationAuthFace<SentryStatus> = new IntegrationAuth<
		SentryStatus,
		OrganizationFacts
	>({ ctx, config, state, store, flow, bridge, spec: sentryAuthSpec });
	const panel = new PanelApi({ bridge, state });

	// The digest plugin, when it is installed, composes this plugin's error block
	// into its card; nothing is read until a digest actually asks.
	registerDigestSource(ctx, { bridge, state });

	// The correlation plugin, when it is installed, asks this plugin about one
	// issue so a chain can start from it; nothing is read until it asks.
	registerCorrelationSource(ctx, { bridge, state });

	// Registering the flow tells the harness this credential can be authorized,
	// and routes each attempt's notices to whoever started it.
	const disposeFlow = ctx.authorization.registerFlow({
		key: store.credentialKey,
		label: "Sentry",
		methods: [{ id: OAUTH_METHOD, label: "Sign in with Sentry" }],
		run: async (session) => {
			await flow.run(ctx, session);
		},
	});

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: COMMAND_NAME,
		description: "Sentry: status | login | logout | sync",
		input: { hint: "status | login | logout | sync" },
		handler: createCommandHandler(auth),
	});

	// The presentation tool is registered beside the MCP tools it resolves
	// through: it shows what they return as a card under the agent's answer.
	ctx.tools.register(presentTool.create({ bridge, state }));

	// The card's and the panel's channel to the host: a named route is how a
	// plugin serves the page without a generated remote namespace.
	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: createApiHandler({ auth, panel }),
	});

	ctx.effect(
		() => () => {
			disposeFlow();
			// Closing the MCP connection also withdraws every published Sentry tool.
			return bridge.drop();
		},
		"sentry: flow and MCP bridge",
	);

	// A signed-in user gets tools without a restart. A fresh install stays dormant
	// until someone runs `/sentry login`.
	void auth.connect().then((ready) => {
		if (!ready) logger.info("[sentry] not signed in yet — run /sentry login");
	});
}

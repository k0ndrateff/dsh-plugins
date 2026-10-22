/**
 * dsh-figma — Figma for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half owns what is Figma's — the node the
 * panel shows, the tool that presents it, and the `/figma` command's own wording
 * — while `dsh-integration-host` owns the shell every integration shares: the
 * settings route, the slash command contract and the status document.
 * `lib/client.js` contributes the settings card, the result card, and the side
 * panel to the Web Client.
 *
 * Figma is reached through its Dev Mode MCP server, which the desktop app serves
 * on loopback. That server needs no credential, so this plugin stores none and
 * the bridge is built without an `authProvider`; what it needs is the app to be
 * running, which is what the settings card reports when it is not.
 *
 * This module is the composition root: it builds one of each collaborator and
 * hands them to the surfaces that need them.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools` and
// `ctx.commands` are declared by the packages that own them, not by cordis.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-tools";
import { mountIntegrationRoute, RuntimeState } from "dsh-integration-host";
import { loggerOf, McpBridge, publicToolName } from "dsh-mcp-oauth";
import { FigmaAuth } from "./auth";
import { type ConfigInput, PLUGIN_NAME, resolveConfig } from "./config";
import { PanelApi } from "./panels/panel";
import { profileOf } from "./profile";
import { COMMAND_NAME, createCommandHandler } from "./surface/command";
import { createApiHandler, ROUTE_PREFIX } from "./surface/http";
import { presentTool } from "./tools/present";

export const name = PLUGIN_NAME;

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "commands"];

/** How the Dev Mode server sees this client. */
const CLIENT_INFO = { name: "dsh-figma", version: "0.1.0" };

/**
 * @param ctx - host context carrying tools and commands.
 * @param configInput - `endpoint` and `debug` from the bundle patch.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const state = new RuntimeState();
	const logger = loggerOf(ctx);
	const profile = profileOf(config);

	const bridge = new McpBridge({ profile, clientInfo: CLIENT_INFO });
	const auth = new FigmaAuth({ ctx, config, bridge, state });
	const panel = new PanelApi({ bridge, ctx });

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: COMMAND_NAME,
		description: "Figma: status | login | logout | sync",
		input: { hint: "status | login | logout | sync" },
		handler: createCommandHandler(auth),
	});

	// The presentation tool resolves its node through the same read the panel
	// makes, so the card and the panel can never show different facts.
	ctx.tools.register(
		presentTool.create({
			panel,
			imageTool: publicToolName("get_screenshot", profile.toolNamespace),
		}),
	);

	// The card's and the panel's channel to the host: a named route is how a
	// plugin serves the page without a generated remote namespace.
	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: createApiHandler({ auth, panel }),
	});

	ctx.effect(() => () => bridge.drop(), "figma: MCP bridge");

	// The desktop app may not be running, and that is an ordinary state rather
	// than a failure: the plugin stays dormant until someone starts it and asks
	// the settings card to check again.
	void auth.connect().then((ready) => {
		if (!ready)
			logger.info(
				"[figma] no Dev Mode MCP server yet — start the Figma desktop app and enable it in its preferences",
			);
	});
}

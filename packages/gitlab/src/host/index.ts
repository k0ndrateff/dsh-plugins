/**
 * dsh-gitlab — GitLab for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half owns what is GitLab's — the account a
 * token belongs to, the merge request panel, the review gate, and the `/gitlab`
 * command's own wording — while `dsh-integration-host` owns the shell every
 * integration shares: the settings route, the slash command and the status
 * document. `lib/client.js` contributes the settings card, the result cards, and
 * the side panel to the Web Client.
 *
 * GitLab is reached through its REST API with a personal access token the user
 * pastes, not through a browser flow: GitLab's MCP server issues tokens that
 * only work at the MCP endpoint, and the endpoint itself is switched off per
 * group, so a token the user already has is the honest way in.
 *
 * This module is the composition root: it builds one of each collaborator and
 * hands them to the surfaces that need them.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools`,
// `ctx.credentials`, and `ctx.commands` are declared by the packages that own
// them, not by cordis itself.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-tools";
import { type RouteHost, RuntimeState } from "dsh-integration-host";
import { loggerOf } from "dsh-mcp-oauth";
import type { GitLabAccount } from "./account";
import { GitLabApi } from "./api";
import { GitLabAuth } from "./auth";
import { type ConfigInput, PLUGIN_NAME, resolveConfig } from "./config";
import { PanelApi } from "./panels/panel";
import { ReviewService } from "./review";
import { COMMAND_NAME, createCommandHandler } from "./surface/command";
import { createApiHandler, ROUTE_PREFIX } from "./surface/http";
import { TokenStore } from "./token";
import { presentTool } from "./tools/present";
import { reviewTool } from "./tools/review";

export const name = PLUGIN_NAME;

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "credentials", "commands"];

/**
 * @param ctx - host context carrying tools, credentials, and commands.
 * @param configInput - `endpoint` and `debug` from the bundle patch.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const state = new RuntimeState<GitLabAccount>();
	const logger = loggerOf(ctx);

	const token = new TokenStore(ctx);
	const api = new GitLabApi({ config, token });
	const auth = new GitLabAuth({ ctx, config, api, token, state });
	const panel = new PanelApi({ api, state });
	const review = new ReviewService(api);

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: COMMAND_NAME,
		description: "GitLab: status | login | logout | sync",
		input: { hint: "status | login | logout | sync" },
		handler: createCommandHandler(auth),
	});

	// The presentation tool is registered beside the reads it resolves through:
	// it shows what they return as a card under the agent's answer.
	ctx.tools.register(presentTool.create({ api, state }));
	// The review tool shares its confirmation gate with the side panel, so a
	// social action is never sent without the user having read it first.
	ctx.tools.register(reviewTool.create({ review }));

	// The card's and the panel's channel to the host: a named route is how a
	// plugin serves the page without a generated remote namespace.
	const webServer = (ctx as { get?: (name: string) => unknown }).get?.(
		"webServer",
	) as RouteHost | undefined;

	const disposeRoute = webServer?.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: createApiHandler({ auth, panel, review }),
	});

	if (disposeRoute === undefined)
		logger.warn(
			"[gitlab] no web server route; the settings card cannot reach the host",
		);

	ctx.effect(() => () => disposeRoute?.(), "gitlab: route");

	// A stored token is verified at startup, so the panel and the tools work
	// without a first click. A fresh install stays dormant until someone pastes
	// a token in the GitLab settings card.
	void auth.connect().then((ready) => {
		if (!ready)
			logger.info(
				"[gitlab] no usable token yet — paste one in the GitLab settings card",
			);
	});
}

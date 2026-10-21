/**
 * dsh-digest — the daily digest.
 *
 * The plugin is a bundle and a *meta* one: it owns no provider connection and
 * no credential. What it owns is the composition — a registry the integrations
 * offer their blocks to, the settings that say what a digest contains and when
 * it arrives, the `digest` tool that assembles one, and the `/digest` command
 * that binds it to a session.
 *
 * It is the fourth package to need the host-half shell, and the first that is
 * not an integration: `dsh-integration-host` still supplies the settings route
 * and the status document, while `lib/client.js` contributes the settings card
 * and the turn-tail card the tool publishes.
 *
 * Nothing here writes to an external system, by design: a digest arrives on a
 * schedule, with nobody watching, and a summary that can change the world is
 * not a summary.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-commands";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type {} from "@deepseek-ai/dsh-tools";
import { DigestSources, mountIntegrationRoute } from "dsh-integration-host";
import { DigestAuth } from "./auth";
import { DigestCollector } from "./collect";
import { createDigestCommand } from "./command";
import { createApiHandler, ROUTE_PREFIX } from "./http";
import { DigestSchedule } from "./schedule";
import { DigestSettingsStore, settingsPathIn } from "./settings";
import { digestTool } from "./tool";

export const name = "dsh-digest";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "commands"];

/** The command's name, without the leading slash. */
export const COMMAND_NAME = "digest";

/**
 * @param ctx - host context carrying tools and commands.
 */
export function apply(ctx: Context): void {
	const settings = new DigestSettingsStore(settingsPathIn(resolveDshHome()));

	// Providing the registry is what makes the integrations' contributions
	// possible: each of them registers through a scoped `inject` on this name, so
	// a deployment without this plugin simply never calls them.
	new DigestSources(ctx);

	const collector = new DigestCollector({ ctx, settings });
	const schedule = new DigestSchedule(ctx);
	const auth = new DigestAuth({ ctx, settings });

	// The settings document is read once, asynchronously; every surface answers
	// from the defaults until it lands, which is a truthful answer for a first
	// run and a brief one for a later start.
	void settings.ensure();

	ctx.tools.register(digestTool({ collector }));

	ctx.commands.register({
		name: COMMAND_NAME,
		description:
			"Work digest: status | now | on | off | time | timezone | days | blocks",
		input: {
			hint: "now | on | off | time HH:MM | timezone <IANA zone> | days mon,tue,... | blocks <id> on|off",
		},
		handler: createDigestCommand({ collector, settings, schedule }),
	});

	// The card's channel to the host: a named route is how a plugin serves the
	// page without a generated remote namespace.
	mountIntegrationRoute(ctx, {
		prefix: ROUTE_PREFIX,
		handler: createApiHandler({ auth, settings, collector, schedule }),
	});
}

/**
 * dsh-correlation — cross-provider chains.
 *
 * The plugin is a bundle and a *meta* one: it owns no provider connection and no
 * credential. What it owns is the composition — a registry the integrations
 * offer what they can resolve to, and the `correlate` tool that walks from one
 * object to whatever the rest know about it.
 *
 * It is the second package that is not an integration, after the digest, and it
 * shares the same seam: `dsh-integration-host` declares what a contribution is,
 * this plugin provides the registry, and each integration registers into it
 * through a scoped `ctx.inject` — so the order packages load in does not matter,
 * and a deployment without this plugin simply never asks.
 *
 * Nothing here writes to an external system: a chain is an answer, not an
 * action.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-tools";
import { CorrelationSources } from "dsh-integration-host";
import { correlateTool } from "./tool";

export const name = "dsh-correlation";

/** Services this plugin needs before it can activate. */
export const inject = ["tools"];

/**
 * @param ctx - host context carrying tools.
 */
export function apply(ctx: Context): void {
	const sources = new CorrelationSources(ctx);

	ctx.tools.register(correlateTool({ sources }));
}

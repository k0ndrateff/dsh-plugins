/**
 * dsh-integrations — the Web Client half.
 *
 * It contributes one thing to the page: the **Integrations** section in Settings.
 * The section is a shell — it owns the navigation entry and the tab strip, and
 * every tab in it is registered by an integration plugin through
 * `dsh-integration-ui`'s `integrations.tab` contract, so adding an integration
 * never means editing this package.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, and the `settings.section` contract it registers into.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { registerIntegrationsSection } from "./section";
import { installIntegrationsStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots"];

/**
 * Register the page and its stylesheet.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installIntegrationsStyles(), "integrations: stylesheet");

	registerIntegrationsSection(ctx);
};

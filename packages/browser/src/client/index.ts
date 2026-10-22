/**
 * dsh-browser — the Web Client half.
 *
 * It contributes three things to the page:
 *  - one right-Sidebar panel, where the browser the agent is driving is watched
 *    live: the page, its frames, and what the agent is doing on it;
 *  - one keyed tool view for `browser_open`, so a call renders as one line
 *    instead of the raw JSON behind it — and so the panel is already showing the
 *    page by the time the reader looks up from the agent's answer;
 *  - the stylesheet the two are drawn with.
 *
 * The seats themselves — the tab type, the panel shell, the terse tool row —
 * come from `dsh-integration-ui`; this half says what is the browser's and
 * registers each seat under this plugin's own tab kind and tool name.
 *
 * The Sidebar's tab registry may not be composed at all, so its registration is
 * scoped: everything else this half contributes has to work in a build without a
 * right panel, and a plugin that waited for one would not activate at all.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself and the right Sidebar's tab-type registry with its parameter map.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { registerBrowserOpenRow } from "./components/tool-row";
import { PANEL_ID, panelDefinition } from "./sidebar/definition";
import { installPanelOpener } from "./sidebar/open";
import { BrowserPanel, BrowserPanelTitle } from "./sidebar/panel";
import { installBrowserStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots"];

/**
 * Register the stylesheet, the panel, its title, and the tool row.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installBrowserStyles(), "browser: stylesheet");

	// The tool row opens the panel through this, and it is a no-op in a build
	// without one: the click then stays with the browser.
	installPanelOpener(ctx);

	// The Sidebar's tab registry may not be composed at all, and this plugin must
	// not wait for it: the tool row has to work either way.
	ctx.inject(["sidebarRightTabs"], (scoped) => {
		scoped.effect(
			() => scoped.sidebarRightTabs.register(panelDefinition()),
			"browser: panel type",
		);

		scoped.slots.inject("sidebar.right.pane.tab", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab", key: PANEL_ID },
				BrowserPanel,
			),
		);

		scoped.slots.inject("sidebar.right.pane.tab.title", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab.title", key: PANEL_ID },
				BrowserPanelTitle,
			),
		);
	});

	// The row claims `browser_open` for itself, so its key travels with it.
	registerBrowserOpenRow(ctx);
};

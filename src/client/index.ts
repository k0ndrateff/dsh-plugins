/**
 * dsh-atlassian — the Web Client half.
 *
 * It contributes four things to the page:
 *  - an **Integrations** section in Settings, with the sign-in state and the
 *    button that starts the OAuth flow in the host;
 *  - one keyed tool view per known Atlassian tool, so a Jira search or issue
 *    read renders as cards instead of raw JSON;
 *  - a turn tail seat, so `atlassian_present` puts its card under the agent's
 *    answer rather than inside the collapsible tool group;
 *  - a right-Sidebar panel, where a click on a card opens the whole issue or
 *    page and the actions that change it.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, the slot contracts, the Chat node kind registry, and the right
// Sidebar's tab-type registry.
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import { PUBLIC_TOOL_NAMES } from "../shared/tool-names";
import { PresentationTail } from "./components/presentation-tail";
import { AtlassianSection } from "./components/settings-section";
import { AtlassianToolRow } from "./components/tool-row";
import { presentationDefinition } from "./conversation/presentation-definition";
import { PLUGIN_ID } from "./plugin-id";
import { PANEL_ID, panelDefinition } from "./sidebar/definition";
import { installPanelOpener } from "./sidebar/open";
import { AtlassianPanel } from "./sidebar/panel";
import { AtlassianPanelTitle } from "./sidebar/title";
import { installStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the section, the tool views, the presentation cards, and the panel.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installStyles(), "atlassian: stylesheet");

	// The card's payload arrives as a durable session record; this definition
	// turns it into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(presentationDefinition);

	// Cards open the panel through this, and it is a no-op in a build without
	// one: the click then stays with the browser.
	installPanelOpener(ctx);

	// The Sidebar's tab registry may not be composed at all, and this plugin
	// must not wait for it: everything else it contributes — the settings
	// section, the tool rows, the cards — has to work either way.
	ctx.inject(["sidebarRightTabs"], (scoped) => {
		scoped.effect(
			() => scoped.sidebarRightTabs.register(panelDefinition()),
			"atlassian: panel type",
		);

		scoped.slots.inject("sidebar.right.pane.tab", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab", key: PANEL_ID },
				AtlassianPanel,
			),
		);

		scoped.slots.inject("sidebar.right.pane.tab.title", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab.title", key: PANEL_ID },
				AtlassianPanelTitle,
			),
		);
	});

	// `inject` waits for the owning package to declare the slot, so this
	// registration survives the Settings page not being open yet.
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "integrations",
				order: 20,
				label: () => "Integrations",
			},
			AtlassianSection,
		),
	);

	ctx.slots.inject("tool.call.toolview", () => {
		const disposers = PUBLIC_TOOL_NAMES.map((name) =>
			ctx.slots.register(
				{ name: "tool.call.toolview", key: name },
				AtlassianToolRow,
			),
		);

		return () => {
			for (const dispose of disposers) dispose();
		};
	});

	// Under the closing prose of the turn, beside the delivered-file cards.
	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{
				name: "conversation.chat.turnTail",
				id: PLUGIN_ID,
				order: 20,
			},
			PresentationTail,
		),
	);
};

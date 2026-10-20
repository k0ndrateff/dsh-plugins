/**
 * dsh-sentry — the Web Client half.
 *
 * It contributes four things to the page:
 *  - a **Sentry** section in Settings, with the sign-in state and the buttons
 *    that drive the OAuth flow in the host;
 *  - one keyed tool view for `sentry_present`, so a call renders as one line
 *    instead of the raw JSON behind it;
 *  - a turn tail seat, so `sentry_present` puts its card under the agent's
 *    answer rather than inside the collapsible tool group;
 *  - a right-Sidebar panel, where a click on a card opens the whole issue and
 *    the actions that change it.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, the slot contracts, the Chat node kind registry, the right Sidebar's
// tab-type registry, and the Settings section contract.
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import { SentryTail } from "./components/issue-card";
import { SentrySection } from "./components/settings-section";
import { SentryToolRow } from "./components/tool-row";
import {
	SENTRY_TOOL_NAME,
	sentryDefinition,
} from "./conversation/card-definition";
import { PLUGIN_ID } from "./plugin-id";
import { PANEL_ID, panelDefinition } from "./sidebar/definition";
import { installPanelOpener } from "./sidebar/open";
import { SentryPanel } from "./sidebar/panel";
import { SentryPanelTitle } from "./sidebar/title";
import { installStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the section, the tool view, the presentation cards, and the panel.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installStyles(), "sentry: stylesheet");

	// The card's payload arrives as a durable session record; this definition
	// turns it into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(sentryDefinition);

	// Cards open the panel through this, and it is a no-op in a build without
	// one: the click then stays with the browser.
	installPanelOpener(ctx);

	// The Sidebar's tab registry may not be composed at all, and this plugin
	// must not wait for it: everything else it contributes — the settings
	// section, the tool row, the cards — has to work either way.
	ctx.inject(["sidebarRightTabs"], (scoped) => {
		scoped.effect(
			() => scoped.sidebarRightTabs.register(panelDefinition()),
			"sentry: panel type",
		);

		scoped.slots.inject("sidebar.right.pane.tab", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab", key: PANEL_ID },
				SentryPanel,
			),
		);

		scoped.slots.inject("sidebar.right.pane.tab.title", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab.title", key: PANEL_ID },
				SentryPanelTitle,
			),
		);
	});

	// `inject` waits for the owning package to declare the slot, so this
	// registration survives the Settings page not being open yet.
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "sentry",
				order: 21,
				label: () => "Sentry",
			},
			SentrySection,
		),
	);

	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: SENTRY_TOOL_NAME },
			SentryToolRow,
		),
	);

	// Under the closing prose of the turn, beside the delivered-file cards.
	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{
				name: "conversation.chat.turnTail",
				id: PLUGIN_ID,
				order: 21,
			},
			SentryTail,
		),
	);
};

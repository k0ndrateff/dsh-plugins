/**
 * dsh-figma — the Web Client half.
 *
 * It contributes four things to the page:
 *  - a **Figma** section in Settings, with the connection state of the Dev Mode
 *    MCP server and the button that checks it again;
 *  - one keyed tool view for `figma_present`, so a call renders as one line
 *    instead of the raw JSON behind it — and so the panel opens on the node the
 *    call settled on while the agent is still working;
 *  - a turn tail seat, so `figma_present` puts its card under the agent's answer
 *    rather than inside the collapsible tool group;
 *  - a right-Sidebar panel, where a node is looked at: its picture, its
 *    variables, and what it maps to in the codebase.
 *
 * The seats themselves — the panel body, the card, the tool row, the settings
 * card, and the stylesheet they are drawn with — come from `dsh-integration-ui`;
 * this half says what is Figma's and registers each seat under this plugin's own
 * tab kind and tool names.
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
import { FigmaTail } from "./components/presentation-tail";
import { FigmaSection } from "./components/settings-section";
import { FigmaPresentRow } from "./components/tool-row";
import {
	FIGMA_PRESENT_TOOL,
	figmaPresentation,
} from "./conversation/card-definition";
import { PLUGIN_ID } from "./plugin-id";
import { PANEL_ID, panelDefinition } from "./sidebar/definition";
import { installPanelOpener } from "./sidebar/open";
import { FigmaPanel, FigmaPanelTitle } from "./sidebar/panel";
import { installFigmaStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the section, the tool view, the presentation card, and the panel.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installFigmaStyles(), "figma: stylesheet");

	// The card's payload arrives as a durable session record; this definition
	// turns it into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(figmaPresentation.definition);

	// The card and the tool row open the panel through this, and it is a no-op in
	// a build without one: the click then stays with the browser.
	installPanelOpener(ctx);

	// The Sidebar's tab registry may not be composed at all, and this plugin must
	// not wait for it: everything else it contributes — the settings section, the
	// tool row, the cards — has to work either way.
	ctx.inject(["sidebarRightTabs"], (scoped) => {
		scoped.effect(
			() => scoped.sidebarRightTabs.register(panelDefinition()),
			"figma: panel type",
		);

		scoped.slots.inject("sidebar.right.pane.tab", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab", key: PANEL_ID },
				FigmaPanel,
			),
		);

		scoped.slots.inject("sidebar.right.pane.tab.title", () =>
			scoped.slots.register(
				{ name: "sidebar.right.pane.tab.title", key: PANEL_ID },
				FigmaPanelTitle,
			),
		);
	});

	// `inject` waits for the owning package to declare the slot, so this
	// registration survives the Settings page not being open yet.
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "figma",
				order: 23,
				label: () => "Figma",
			},
			FigmaSection,
		),
	);

	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: FIGMA_PRESENT_TOOL },
			FigmaPresentRow,
		),
	);

	// Under the closing prose of the turn, beside the delivered-file cards.
	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{
				name: "conversation.chat.turnTail",
				id: PLUGIN_ID,
				order: 23,
			},
			FigmaTail,
		),
	);
};

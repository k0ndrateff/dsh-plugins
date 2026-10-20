/**
 * dsh-devkit — the Web Client half.
 *
 * It contributes two things to the page:
 *  - a **keyed tool view** for `checks`, so a run reports one line instead of the
 *    raw JSON of every failure;
 *  - a **turn tail seat**, so the card with the failures sits under the agent's
 *    answer, where the user is reading, and a click opens the file.
 *
 * The seats themselves — the card's chrome, the tool row, and the stylesheet
 * they are drawn with — come from `dsh-integration-ui`; this half says what is
 * devkit's and registers each seat under this plugin's own tool name.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, the slot contracts, and the Chat node kind registry.
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import { ChecksTail } from "./components/checks-tail";
import { ChecksToolRow } from "./components/tool-row";
import {
	CHECKS_TOOL_NAME,
	checksPresentation,
} from "./conversation/card-definition";
import { PLUGIN_ID } from "./plugin-id";
import { installDevkitStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the tool view, the card, and the stylesheet.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installDevkitStyles(), "devkit: stylesheet");

	// The card's payload arrives as a durable session record; this definition
	// turns it into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(checksPresentation.definition);

	// `inject` waits for the owning package to declare the slot, so these
	// registrations survive a page that composes the Chat without a tool group.
	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: CHECKS_TOOL_NAME },
			ChecksToolRow,
		),
	);

	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{ name: "conversation.chat.turnTail", id: PLUGIN_ID, order: 20 },
			ChecksTail,
		),
	);
};

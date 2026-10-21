/**
 * dsh-correlation — the Web Client half.
 *
 * It contributes three things to the page:
 *  - one keyed tool view for `correlate`, so a call renders as one line instead
 *    of the chain behind it;
 *  - a turn tail seat, so the chain lands under the agent's answer rather than
 *    inside the collapsible tool group;
 *  - the stylesheet they are both drawn with.
 *
 * The seats themselves come from `dsh-integration-ui`; this half says what is
 * the chain's and registers each seat under this plugin's own id and tool name.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, the Chat node kind registry, and the tool-view contract.
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import { ChainTail } from "./components/chain-tail";
import { ChainToolRow } from "./components/tool-row";
import {
	CHAIN_TOOL_NAME,
	correlationPresentation,
} from "./conversation/card-definition";
import { PLUGIN_ID } from "./plugin-id";
import { installCorrelationStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the tool view and the chain cards.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installCorrelationStyles(), "correlation: stylesheet");

	// The chain arrives as a durable session record; this definition turns it
	// into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(correlationPresentation.definition);

	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: CHAIN_TOOL_NAME },
			ChainToolRow,
		),
	);

	// Under the closing prose of the turn, beside the delivered-file cards.
	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{ name: "conversation.chat.turnTail", id: PLUGIN_ID, order: 30 },
			ChainTail,
		),
	);
};

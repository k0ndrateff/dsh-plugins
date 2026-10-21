/**
 * dsh-digest — the Web Client half.
 *
 * It contributes four things to the page:
 *  - a **Daily digest** section in Settings, where the blocks, the days and the
 *    time are chosen and one digest can be assembled on demand;
 *  - one keyed tool view for `digest`, so a call renders as one line instead of
 *    the report behind it;
 *  - a turn tail seat, so the digest lands under the agent's answer rather than
 *    inside the collapsible tool group;
 *  - the stylesheet they are all drawn with.
 *
 * The seats themselves — the card material, the tool row, the settings rows —
 * come from `dsh-integration-ui`; this half says what is the digest's and
 * registers each seat under this plugin's own id and tool name.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this half needs: the slot registry
// itself, the Chat node kind registry, the Settings section contract, and the
// tool-view contract.
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import { DigestTail } from "./components/digest-tail";
import { DigestSettingsSection } from "./components/settings-section";
import { DigestToolRow } from "./components/tool-row";
import {
	DIGEST_TOOL_NAME,
	digestPresentation,
} from "./conversation/card-definition";
import { PLUGIN_ID } from "./plugin-id";
import { installDigestStyles } from "./styles/styles-runtime";

/** The client services this half needs. */
export const inject = ["slots", "uiConversation"];

/**
 * Register the settings section, the tool view, and the digest cards.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installDigestStyles(), "digest: stylesheet");

	// The report arrives as a durable session record; this definition turns it
	// into a Chat node the turn tail can select.
	ctx.uiConversation.events.register(digestPresentation.definition);

	// `inject` waits for the owning package to declare the slot, so this
	// registration survives the Settings page not being open yet.
	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "digest",
				order: 25,
				label: () => "Digest",
			},
			DigestSettingsSection,
		),
	);

	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: DIGEST_TOOL_NAME },
			DigestToolRow,
		),
	);

	// Under the closing prose of the turn, beside the delivered-file cards.
	ctx.slots.inject("conversation.chat.turnTail", () =>
		ctx.slots.register(
			{ name: "conversation.chat.turnTail", id: PLUGIN_ID, order: 25 },
			DigestTail,
		),
	);
};

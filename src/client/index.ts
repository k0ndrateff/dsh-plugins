/**
 * dsh-atlassian-plugin — the Web Client half.
 *
 * It contributes two things to the page:
 *  - an **Atlassian** section in Settings, with the sign-in state and the
 *    button that starts the OAuth flow in the host;
 *  - one keyed tool view per known Atlassian tool, so a Jira search or issue
 *    read renders as cards instead of raw JSON.
 *
 * The bundle is built into the client module system's lazy factory format, so
 * this module's exports are the Cordis plugin the loader hands to the tree.
 */

import type { Context } from "@deepseek-ai/cordis";
import { PUBLIC_TOOL_NAMES } from "../shared/tool-names";
import { AtlassianSection } from "./components/settings-section";
import { AtlassianToolRow } from "./components/tool-row";
import { installStyles } from "./styles/styles-runtime";

/** The one client service this half needs. */
export const inject = ["slots"];

/**
 * Register the section and the tool views.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const apply = (ctx: Context): void => {
	// The compiled stylesheet is inlined into this bundle at build time and
	// tagged with the plugin id, so turning the plugin off removes it too.
	ctx.effect(() => installStyles(), "atlassian: stylesheet");

	// `inject` waits for the owning package to declare the slot, so this
	// registration survives the Settings page not being open yet.
	// @ts-expect-error
	ctx.slots.inject("settings.section", () =>
		// @ts-expect-error
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

	// @ts-expect-error
	ctx.slots.inject("tool.call.toolview", () => {
		const disposers = PUBLIC_TOOL_NAMES.map((name) =>
			// @ts-expect-error
			ctx.slots.register(
				{
					name: "tool.call.toolview",
					key: name,
				},
				AtlassianToolRow,
			),
		);
		return () => {
			for (const dispose of disposers) dispose();
		};
	});
};

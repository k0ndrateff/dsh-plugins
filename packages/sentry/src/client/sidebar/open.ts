/**
 * Opening the side panel from anywhere in the page.
 *
 * The cards do not hold the client context, and the panel belongs to a package
 * that may not be composed at all, so the opener keeps the context this plugin
 * was applied with and resolves the Sidebar's navigation face on every click.
 * A build without the right panel answers `false`, and the caller leaves the
 * click to the browser rather than swallowing it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { MouseEvent } from "react";
import { PANEL_KIND, type PanelTarget } from "./definition";

let host: Context | undefined;

/**
 * Remember the context the panel navigates through.
 * @param ctx - this plugin's client context.
 */
export const installPanelOpener = (ctx: Context): void => {
	host = ctx;
};

/**
 * Show one issue in the harness's own right panel.
 * @param target - what to open.
 * @returns whether a panel took it; `false` means there is no panel here.
 */
export const openPanel = (target: PanelTarget): boolean => {
	const sidebar = host?.get("sidebarRight");
	if (sidebar === undefined) return false;

	try {
		sidebar.openTab(PANEL_KIND, { params: target });
		return true;
	} catch {
		// Nothing registered the kind: a wiring mistake inside this plugin, and
		// still no reason to eat the user's click.
		return false;
	}
};

/**
 * Whether a click is the user asking for the browser.
 *
 * A modified click, a middle click, or a click on a link that is already
 * handled elsewhere must keep its native behaviour.
 * @param event - the click on a card's link.
 * @returns whether the card should do nothing and let the anchor work.
 */
export const wantsBrowser = (event: MouseEvent<HTMLElement>): boolean => {
	return (
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		event.button !== 0
	);
};

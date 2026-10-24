/**
 * Opening the side panel from anywhere in the page.
 *
 * The cards do not hold the client context, and the panel belongs to a package
 * that may not be composed at all, so the opener keeps the context the plugin
 * was applied with and resolves the Sidebar's navigation face on every click.
 */

import type { Context } from "@deepseek-ai/cordis";
import { createLazyPanelOpener } from "dsh-integration-ui";
import type { PanelTarget } from "../../shared/panel";
import { PANEL_KIND } from "./definition";

const panel = createLazyPanelOpener(PANEL_KIND);

/** Remember the context the panel navigates through. */
export const installPanelOpener = (ctx: Context): void => {
	panel.install(ctx);
};

/**
 * Show one item in the harness's own right panel.
 * @param target - what to open.
 * @returns whether a panel took it; `false` means there is no panel here.
 */
export const openPanel = (target: PanelTarget): boolean =>
	panel.open(target as never);

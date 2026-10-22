/**
 * Opening the browser panel from anywhere in the page.
 *
 * The tool row does not hold the client context, and the panel belongs to a
 * package that may not be composed at all, so this keeps the opener the plugin
 * was applied with and lets `dsh-integration-ui` resolve the Sidebar's
 * navigation face on every call. A build without the right panel answers
 * `false`, and the caller leaves the click to the browser rather than
 * swallowing it.
 */

import type { Context } from "@deepseek-ai/cordis";
import { createPanelOpener, type PanelOpener } from "dsh-integration-ui";
import { type BrowserTabParams, PANEL_KIND } from "./definition";

let opener: PanelOpener<typeof PANEL_KIND> | undefined;

/**
 * Remember the context the panel navigates through.
 * @param ctx - this plugin's client context.
 */
export const installPanelOpener = (ctx: Context): void => {
	opener = createPanelOpener(ctx, PANEL_KIND);
};

/**
 * Show one session's browser in the harness's own right panel.
 * @param target - the session to watch, and the address it was opened on.
 * @returns whether a panel took it; `false` means there is no panel here.
 */
export const openPanel = (target: BrowserTabParams): boolean =>
	opener?.open(target) ?? false;

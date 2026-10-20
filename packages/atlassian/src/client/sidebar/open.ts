/**
 * Opening the side panel from anywhere in the page.
 *
 * The cards do not hold the client context, and the panel belongs to a package
 * that may not be composed at all, so this keeps the opener the plugin was
 * applied with and lets `dsh-integration-ui` resolve the Sidebar's navigation
 * face on every click. A build without the right panel answers `false`, and the
 * caller leaves the click to the browser rather than swallowing it.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	createPanelOpener,
	type PanelOpener,
	wantsBrowser,
} from "dsh-integration-ui";
import type { PanelTarget } from "../../shared/panel";
import { PANEL_KIND } from "./definition";

let opener: PanelOpener<typeof PANEL_KIND> | undefined;

/**
 * Remember the context the panel navigates through.
 * @param ctx - this plugin's client context.
 */
export const installPanelOpener = (ctx: Context): void => {
	opener = createPanelOpener(ctx, PANEL_KIND);
};

/**
 * Show one issue or page in the harness's own right panel.
 * @param target - what to open.
 * @returns whether a panel took it; `false` means there is no panel here.
 */
export const openPanel = (target: PanelTarget): boolean =>
	opener?.open(target) ?? false;

export { wantsBrowser };

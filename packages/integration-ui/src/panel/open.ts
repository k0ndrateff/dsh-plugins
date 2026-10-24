/**
 * Opening one integration's side panel from anywhere in the page.
 *
 * The cards do not hold the client context, and the panel belongs to a package
 * that may not be composed at all, so the opener keeps the context the plugin
 * was applied with and resolves the Sidebar's navigation face on every click. A
 * build without the right panel answers `false`, and the caller leaves the click
 * to the browser rather than swallowing it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SidebarRightTabParamsFor } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { MouseEvent } from "react";

/** The navigation face one integration's cards open their panel through. */
export interface PanelOpener<K extends string> {
	/**
	 * Show one item in the harness's own right panel.
	 * @param params - what to open.
	 * @returns whether a panel took it; `false` means there is no panel here.
	 */
	open(params: NonNullable<SidebarRightTabParamsFor<K>>): boolean;
}

/** An opener bound lazily when the plugin's client half is applied. */
export interface LazyPanelOpener<K extends string> {
	/** Remember the context the panel navigates through. */
	install(ctx: Context): void;
	/** Show one item in the harness's own right panel. */
	open(params: NonNullable<SidebarRightTabParamsFor<K>>): boolean;
}

/**
 * Build one lazy opener for a plugin's tab kind.
 *
 * The cards do not hold the client context, so the opener is installed once at
 * apply time and every click goes through it. One factory keeps the five
 * integrations from repeating that module-level `let`.
 * @param kind - the tab kind the plugin registered.
 */
export const createLazyPanelOpener = <K extends string>(
	kind: K,
): LazyPanelOpener<K> => {
	let opener: PanelOpener<K> | undefined;

	return {
		install: (ctx) => {
			opener = createPanelOpener(ctx, kind);
		},
		open: (params) => opener?.open(params) ?? false,
	};
};

/**
 * Build the opener for one integration's tab kind.
 * @param ctx - the plugin's client context.
 * @param kind - the tab kind this plugin registered.
 */
export const createPanelOpener = <K extends string>(
	ctx: Context,
	kind: K,
): PanelOpener<K> => {
	return {
		open: (params) => {
			const sidebar = ctx.get("sidebarRight");
			if (sidebar === undefined) return false;

			try {
				sidebar.openTab(kind, { params });
				return true;
			} catch {
				// Nothing registered the kind: a wiring mistake inside this plugin, and
				// still no reason to eat the user's click.
				return false;
			}
		},
	};
};

/**
 * Whether a click is the user asking for the browser.
 *
 * A modified click, a middle click, or a click on a link that is already handled
 * elsewhere must keep its native behaviour.
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

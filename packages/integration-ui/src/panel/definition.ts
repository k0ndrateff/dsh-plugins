/**
 * One integration's side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes —
 * the same two-stage registration a package shipped with the product uses.
 *
 * No `multiple`: one panel per pane. Opening another item navigates the one that
 * is there, which is what makes clicking through a search result feel like
 * following a link rather than opening windows.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";

/** What one integration's tab type says about itself. */
export interface PanelTypeSpec {
	/** This implementation's identity in the tab system; a package name. */
	readonly id: string;
	/** The tab kind this plugin owns; what `openTab` names. */
	readonly kind: string;
	/** The chip's fallback title, until the provider names the item. */
	readonly title: string;
}

/**
 * Build one integration's registry definition; its body and title carry the rest.
 * @param spec - the implementation's identity, its kind, and its fallback title.
 */
export const createPanelDefinition = (
	spec: PanelTypeSpec,
): SidebarRightTabDefinition => {
	return {
		id: spec.id,
		kind: spec.kind,
		// A type from outside the product outranks the shipped ones, which is the
		// band the Sidebar's own documentation reserves for exactly this.
		priority: "extension",
		title: () => spec.title,
	};
};

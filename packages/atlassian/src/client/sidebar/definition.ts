/**
 * The Atlassian side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes —
 * the same two-stage registration a package shipped with the product uses.
 *
 * No `multiple`: one panel per pane. Opening another issue navigates the one
 * that is there, which is what makes clicking through a search result feel like
 * following a link rather than opening windows.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PanelTarget } from "../../shared/panel";

/** The tab kind this plugin owns; what `openTab` names. */
export const PANEL_KIND = "atlassian";

/** This implementation's identity in the tab system: the key its body registers under. */
export const PANEL_ID = "dsh-atlassian";

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
	interface SidebarRightTabParamsMap {
		/** What the Atlassian panel was last navigated to. */
		atlassian: PanelTarget;
	}
}

/** The panel's registry definition; the body and title carry the rest. */
export const panelDefinition = (): SidebarRightTabDefinition => {
	return {
		id: PANEL_ID,
		kind: PANEL_KIND,
		// A type from outside the product outranks the shipped ones, which is the
		// band the Sidebar's own documentation reserves for exactly this.
		priority: "extension",
		title: () => "Atlassian",
	};
};

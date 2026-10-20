/**
 * The GitLab side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes —
 * the same two-stage registration a package shipped with the product uses, with
 * the shared shell of `dsh-integration-ui` doing the registering.
 *
 * No `multiple`: one panel per pane. Opening another merge request navigates the
 * one that is there, which is what makes clicking through a card feel like
 * following a link rather than opening windows.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { createPanelDefinition } from "dsh-integration-ui";
import type { PanelTarget } from "../../shared/panel";

/** The tab kind this plugin owns; what `openTab` names. */
export const PANEL_KIND = "gitlab";

/** This implementation's identity in the tab system: the key its body registers under. */
export const PANEL_ID = "dsh-gitlab";

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
	interface SidebarRightTabParamsMap {
		/** What the GitLab panel was last navigated to. */
		gitlab: PanelTarget;
	}
}

/** The panel's registry definition; the body and title carry the rest. */
export const panelDefinition = (): SidebarRightTabDefinition =>
	createPanelDefinition({ id: PANEL_ID, kind: PANEL_KIND, title: "GitLab" });

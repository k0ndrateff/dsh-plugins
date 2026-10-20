/**
 * The Figma side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes —
 * the same two-stage registration a package shipped with the product uses, with
 * the shared shell of `dsh-integration-ui` doing the registering.
 *
 * No `multiple`: one panel per pane. Showing another node navigates the one that
 * is there, which is what makes the panel follow the agent's work instead of
 * opening a window per frame.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { createPanelDefinition } from "dsh-integration-ui";
import type { PanelTarget } from "../../shared/panel";

/** The tab kind this plugin owns; what `openTab` names. */
export const PANEL_KIND = "figma";

/** This implementation's identity in the tab system: the key its body registers under. */
export const PANEL_ID = "dsh-figma";

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
	interface SidebarRightTabParamsMap {
		/** What the Figma panel was last navigated to. */
		figma: PanelTarget;
	}
}

/** The panel's registry definition; the body and title carry the rest. */
export const panelDefinition = (): SidebarRightTabDefinition =>
	createPanelDefinition({ id: PANEL_ID, kind: PANEL_KIND, title: "Figma" });

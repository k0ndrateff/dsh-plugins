/**
 * The browser side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes.
 *
 * The kind is `dsh-browser`, not `browser`: the product ships its own `browser`
 * tab type — an iframe on a URL, a different browser from the one the agent
 * drives — and two declarations on one kind collide.
 *
 * No `multiple`: one panel per pane. Showing another session's browser
 * navigates the one that is there, which is what keeps a conversation's live
 * viewport in a single place instead of opening a window per call.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { createPanelDefinition } from "dsh-integration-ui";
import { PANEL_ID, PANEL_KIND, type PanelParams } from "../../shared/panel";

export { PANEL_ID, PANEL_KIND };

/** What the browser panel was last navigated to. */
export type BrowserTabParams = PanelParams;

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
	interface SidebarRightTabParamsMap {
		"dsh-browser": BrowserTabParams;
	}
}

/**
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without a session.
 */
export const asBrowserTabParams = (
	value: unknown,
): BrowserTabParams | undefined => {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return undefined;

	const record = value as Record<string, unknown>;
	const session = record.session;
	const url = record.url;

	if (typeof session !== "string" || session === "") return undefined;
	if (url !== undefined && typeof url !== "string") return undefined;

	return { session, ...(url === undefined || url === "" ? {} : { url }) };
};

/** The panel's registry definition; the body and title carry the rest. */
export const panelDefinition = (): SidebarRightTabDefinition => ({
	...createPanelDefinition({
		id: PANEL_ID,
		kind: PANEL_KIND,
		title: "Browser",
	}),
	// The panel is a socket, and a socket is not free to rebuild: a visited body
	// stays mounted through hiding, so switching tabs does not drop the live
	// viewport and start over on the way back.
	keepMounted: true,
});

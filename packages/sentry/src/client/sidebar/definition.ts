/**
 * The Sentry side panel, as a right-Sidebar tab type.
 *
 * A type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat,
 * and the chip title into `sidebar.right.pane.tab.title`, both under this
 * definition's `id`. Nothing here reaches into the Sidebar's store or panes —
 * the same two-stage registration a package shipped with the product uses, with
 * the shared shell of `dsh-integration-ui` doing the registering.
 *
 * No `multiple`: one panel per pane. Opening another issue navigates the one
 * that is there, which is what makes clicking through a search result feel like
 * following a link rather than opening windows.
 */

import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import { createPanelDefinition } from "dsh-integration-ui";

/** The tab kind this plugin owns; what `openTab` names. */
export const PANEL_KIND = "sentry";

/** This implementation's identity in the tab system: the key its body registers under. */
export const PANEL_ID = "dsh-sentry";

/** What the panel was last navigated to: the issue to show. */
export interface PanelTarget {
	/** Sentry's short id, such as `CHECKOUT-13P`. */
	readonly id: string;
	/**
	 * The organization the card was read from.
	 *
	 * A card from organization B must not open organization A's issue of the
	 * same id, so the target carries the organization it was built with; only a
	 * target without one falls back to the selected default.
	 */
	readonly organization?: string;
}

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
	interface SidebarRightTabParamsMap {
		/** What the Sentry panel was last navigated to. */
		sentry: PanelTarget;
	}
}

/**
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without one.
 */
export const asPanelTarget = (value: unknown): PanelTarget | undefined => {
	if (value === null || typeof value !== "object") return undefined;

	const record = value as { id?: unknown; organization?: unknown };
	const id = record.id;

	if (typeof id !== "string" || id === "") return undefined;

	return {
		id,
		...(typeof record.organization === "string" && record.organization !== ""
			? { organization: record.organization }
			: {}),
	};
};

/** The panel's registry definition; the body and title carry the rest. */
export const panelDefinition = (): SidebarRightTabDefinition =>
	createPanelDefinition({ id: PANEL_ID, kind: PANEL_KIND, title: "Sentry" });

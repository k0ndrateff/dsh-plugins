/**
 * The panel's chip in the Sidebar's tab strip.
 *
 * The title is read from the tab's own navigation parameters rather than from
 * the document, so the chip says what the panel is showing before — and even
 * when — the host has answered.
 */

import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import type { PanelProvider } from "./types";

/**
 * Build the title seat for one integration.
 * @param provider - everything that is the integration's rather than the body's.
 * @returns the component the plugin registers under its own tab id.
 */
export const createPanelTitle = <TData, TParams>(
	provider: PanelProvider<TData, TParams>,
): ((props: PropsRuntime<"sidebar.right.pane.tab.title">) => ReactNode) => {
	const Title = (
		props: PropsRuntime<"sidebar.right.pane.tab.title">,
	): ReactNode => {
		const { tab } = props.useTabInfo();
		const params = provider.parseParams(tab.navigation.params);

		return (
			(params === undefined ? undefined : provider.title(params)) ?? tab.title
		);
	};

	return Title;
};

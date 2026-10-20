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
import { asPanelTarget } from "./definition";

/**
 * The panel's title seat.
 * @param props - the tab's live information.
 * @returns the issue id, or the tab's own title when it has none.
 */
export const SentryPanelTitle = (
	props: PropsRuntime<"sidebar.right.pane.tab.title">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const target = asPanelTarget(tab.navigation.params);

	return target?.id ?? tab.title;
};

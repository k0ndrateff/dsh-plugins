/**
 * The chip above the chat: this conversation has a browser, and here is the way
 * back to it.
 *
 * The panel is a right-Sidebar tab, and a tab can be closed. Closing it used to
 * end the story until the agent happened to open another page, which left the
 * person locked out of a browser that was still running. This is the way back:
 * one pill, shown only while there is a browser to go to, naming the address it
 * was last seen at.
 *
 * It says nothing about frames. The panel polls the host every quarter second
 * and keeps the screencast alive; this asks every few seconds, answers from what
 * the host already knows, and stops entirely while the page is hidden.
 */

import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { Pill, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { sessionNameOf } from "../../shared/session";
import * as styles from "../styles/styles.css";
import { openPanel } from "./open";
import { useBrowserState } from "./state";

/** The chip's own name in the slot it occupies. */
export const INDICATOR_ID = "browser";

/** The host a page was on, when the address is one a URL parser accepts. */
const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
};

/**
 * One pill: a dot, the word, and the page it is on.
 *
 * The label is the product's word for this browser rather than the page's title:
 * a title changes on every navigation and a chip that renames itself is hard to
 * aim at. The address is the fact that tells two browsers apart.
 */
export const BrowserIndicator = (
	props: PropsRuntime<"conversation.input.dock">,
): ReactNode => {
	const session = sessionNameOf(props.sessionId);
	const state = useBrowserState(session);

	if (!state.open) return null;

	const host = hostOf(state.url);

	return (
		<div className={styles.indicatorRow}>
			<Pill
				onClick={() => openPanel({ session, url: state.url })}
				title="Show this conversation's browser"
			>
				<StateDot state="done" />
				Browser
				{host === "" ? null : (
					<span className={styles.indicatorHost}>{host}</span>
				)}
			</Pill>
		</div>
	);
};

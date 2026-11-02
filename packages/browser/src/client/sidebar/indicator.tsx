/**
 * The card above the chat: this conversation has a browser, and here is the way
 * back to it.
 *
 * The panel is a right-Sidebar tab, and a tab can be closed. Closing it used to
 * end the story until the agent happened to open another page, which left the
 * person locked out of a browser that was still running. This is the way back:
 * one row in the composer's dock, shown only while there is a browser to go to,
 * naming the page it was last seen on.
 *
 * The dock strip is full width, and its stock occupants — the Goal bar, the TODO
 * panel — each constrain themselves with the composer's own clearance and inset
 * variables. A card that does not do so sits at the strip's left edge instead of
 * under the composer, so this one uses the Goal bar's formula and its menu
 * material: it is meant to read as another harness card, not as a plugin's chip.
 *
 * It says nothing about frames. The panel polls the host every quarter second
 * and keeps the screencast alive; this asks every few seconds, answers from what
 * the host already knows, and stops entirely while the page is hidden.
 */

import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
	IconChevronRightOutlineRegular,
	IconGlobeOutlineRegular,
	StateDot,
	type StateDotState,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import type { PanelPhase, PanelState } from "../../shared/panel";
import { sessionNameOf } from "../../shared/session";
import * as styles from "../styles/styles.css";
import { openPanel } from "./open";
import { useBrowserState } from "./state";

/** The card's own name in the slot it occupies. */
export const INDICATOR_ID = "browser";

/**
 * What the dot says: the browser is there, and whether its live view is up.
 *
 * Green means the host holds the screencast, not merely that the browser exists:
 * a card that is permanently green told a person "all is well" while the panel
 * behind it could not connect at all.
 */
const dotOf = (state: PanelState): StateDotState => {
	if (state.phase === "unreachable") return "error";
	if (state.phase === "closed" || state.phase === "none") return "idle";

	return state.connected ? "done" : "warning";
};

/** The host a page was on, when the address is one a URL parser accepts. */
const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
};

/** What the line says while no page has named itself yet. */
const PHASE_WORD: Record<PanelPhase, string> = {
	none: "No page",
	starting: "Starting…",
	live: "Live view",
	closed: "Closed",
	paused: "Paused",
	unreachable: "Unreachable",
};

/**
 * The card's one flexible line: the page's name, then its host, and only then
 * the phase the browser is in.
 *
 * A title is what a person recognises the page by, so it wins; a host still
 * tells two browsers apart when the title was never read; a phase word is the
 * last resort while neither is known.
 */
const lineOf = (state: PanelState): string => {
	if (state.title !== "") return state.title;

	const host = hostOf(state.url);

	return host === "" ? PHASE_WORD[state.phase] : host;
};

/**
 * One card: a globe, the word, the page it is on, the dot and the way in.
 *
 * The label is the product's word for this browser rather than the page's
 * title: a title changes on every navigation and a card that renames itself is
 * hard to aim at. The page's name goes in the flexing line beside it, and the
 * dot keeps saying whether the live view is actually up.
 */
export const BrowserIndicator = (
	props: PropsRuntime<"conversation.input.dock">,
): ReactNode => {
	const session = sessionNameOf(props.sessionId);
	const state = useBrowserState(session);

	if (!state.open) return null;

	const action = state.connected
		? "Show this conversation's browser (live)"
		: "Show this conversation's browser (live view not connected)";

	return (
		<div className={styles.indicatorDock} data-browser-indicator>
			<button
				type="button"
				className={styles.indicatorBar}
				onClick={() => openPanel({ session, url: state.url })}
				title={action}
				aria-label={state.title === "" ? action : `${action}: ${state.title}`}
			>
				<span className={styles.indicatorGlyph} aria-hidden>
					<IconGlobeOutlineRegular size={14} />
				</span>
				<span className={styles.indicatorLabel}>Browser</span>
				<span className={styles.indicatorTitle}>{lineOf(state)}</span>
				<StateDot state={dotOf(state)} size={10} />
				<span className={styles.indicatorChevron} aria-hidden>
					<IconChevronRightOutlineRegular size={14} />
				</span>
			</button>
		</div>
	);
};

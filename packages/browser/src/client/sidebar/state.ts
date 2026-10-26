/**
 * Whether this conversation has a browser, for the chip above the chat.
 *
 * The panel is a tab someone can close, and until this existed the only way back
 * was the agent opening a page again. The chip answers a much smaller question
 * than the panel does — is there a browser, and where was it last seen — and
 * asks it slowly: every few seconds, and never while the tab is hidden. It is
 * deliberately not the panel's poll: that one keeps the screencast alive, and a
 * chip nobody clicks must not cost a frame.
 */

import {
	boolean,
	literal,
	object,
	oneOf,
	required,
	string,
} from "dsh-integration-host/shape";
import { useEffect, useRef, useState } from "react";
import { type PanelState, stateUrl } from "../../shared/panel";

/** How often the chip asks while a browser is open. */
export const STATE_POLL_MS = 4_000;

/** How often it checks for one when the last answer said there is none. */
const CLOSED_POLL_MS = 15_000;

/** What the chip knows before the first answer: nothing yet. */
const CLOSED: PanelState = {
	phase: "none",
	open: false,
	url: "",
	title: "",
	connected: false,
};

/**
 * Read one answer from the state route.
 * @param value - the parsed body.
 * @returns the state, or undefined when it is not one this half reads.
 */
export const asPanelState = object<PanelState>({
	phase: required(
		oneOf<PanelState["phase"]>(
			literal("none"),
			literal("starting"),
			literal("live"),
			literal("closed"),
			literal("paused"),
			literal("unreachable"),
		),
	),
	open: required(boolean),
	url: required(string),
	title: required(string),
	connected: required(boolean),
});

/**
 * Watch whether one session's browser is open.
 *
 * A failure keeps what was last known and says nothing: a chip is an aside, and
 * a host that is briefly unreachable should not turn it into an error banner.
 * @param session - the conversation's browser session, or undefined to watch none.
 * @returns the last answer, or the closed state before the first one.
 */
export const useBrowserState = (session: string | undefined): PanelState => {
	const [state, setState] = useState<PanelState>(CLOSED);
	const openRef = useRef(false);

	useEffect(() => {
		openRef.current = state.open;
	}, [state.open]);

	useEffect(() => {
		setState(CLOSED);
		openRef.current = false;

		setState(CLOSED);

		if (session === undefined) return;

		let stopped = false;
		let asking = false;
		let timer: number | undefined;

		const schedule = (): void => {
			if (stopped || document.hidden) return;

			timer = window.setTimeout(
				() => void ask(),
				openRef.current ? STATE_POLL_MS : CLOSED_POLL_MS,
			);
		};

		const ask = async (): Promise<void> => {
			if (asking) return;

			asking = true;
			timer = undefined;

			try {
				const response = await fetch(stateUrl(session), {
					headers: { accept: "application/json" },
				});

				if (!response.ok) return;

				const answer = asPanelState(await response.json());

				if (!stopped && answer !== undefined) setState(answer);
			} catch {
				// The chip has nothing to say about a host it could not reach.
			} finally {
				asking = false;
				schedule();
			}
		};

		const onVisibility = (): void => {
			if (document.hidden) return;

			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
			}

			void ask();
		};

		document.addEventListener("visibilitychange", onVisibility);
		void ask();

		return () => {
			stopped = true;
			document.removeEventListener("visibilitychange", onVisibility);

			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session]);

	return state;
};

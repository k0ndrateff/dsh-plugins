/**
 * The live viewport, as one poll of the plugin's own route.
 *
 * A poll rather than a socket, because of where this page runs: the Desktop
 * application serves it from its own `dsh-app://` scheme, and a `WebSocket`
 * cannot be constructed there at all — the constructor refuses a scheme that is
 * not http(s) or ws(s), and a relative address is resolved against that scheme.
 * An ordinary request is what reaches the harness's web server from that page,
 * which is how every other panel in this suite talks to its host.
 *
 * A quarter of a second is the interval: fast enough that a page the agent — or
 * the person — just clicked on is answered before the click feels stale, and
 * cheap because an unchanged page costs one small answer each time. The picture
 * is a separate request — an `<img>` pointed at the frame route, keyed by the
 * sequence the poll reported — so the bytes never pass through JSON. A hidden
 * panel asks nothing at all, which is the only frame rate that matters when
 * nobody is looking.
 */

import {
	boolean,
	isRecord,
	list,
	literal,
	number,
	object,
	oneOf,
	optional,
	required,
	string,
} from "dsh-integration-host/shape";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type PanelActivity,
	type PanelPage,
	type PanelPhase,
	type PanelSnapshot,
	type PanelTab,
	panelUrl,
} from "../../shared/panel";

/** How often one mounted panel asks, while it is being looked at. */
export const POLL_MS = 250;

/** Everything the panel currently knows about one browser. */
export interface BrowserPanelState {
	/** The host's last answer, or undefined until one arrives. */
	readonly snapshot: PanelSnapshot | undefined;
	/** Why the host could not be reached, or undefined when it could. */
	readonly error: string | undefined;
}

/** The state, plus the one verb a click needs: ask now. */
export interface BrowserPanelWatch extends BrowserPanelState {
	/** Ask the host again immediately, instead of waiting for the interval. */
	refresh(): void;
}

/** What the panel knows before the first answer. */
const EMPTY: BrowserPanelState = { snapshot: undefined, error: undefined };

/** One line of the activity log. */
const activity = object<PanelActivity>({
	kind: required(
		oneOf<PanelActivity["kind"]>(
			literal("command"),
			literal("result"),
			literal("human"),
		),
	),
	text: required(string),
	at: required(number),
});

/** The page's own size. */
const page = object<PanelPage>({
	width: required(number),
	height: required(number),
});

/** One tab, as the browser reports it. */
const tab = object<PanelTab>({
	url: required(string),
	title: required(string),
	active: required(boolean),
});

/** Where a conversation's browser is, without deciding whether that is an error. */
const phase = oneOf<PanelPhase>(
	literal("none"),
	literal("starting"),
	literal("live"),
	literal("closed"),
	literal("paused"),
	literal("unreachable"),
);

const snapshot = object<PanelSnapshot>({
	session: required(string),
	phase: required(phase),
	message: required(string),
	connected: required(boolean),
	open: required(boolean),
	paused: required(boolean),
	url: required(string),
	title: required(string),
	tabs: required(list(tab)),
	seq: required(number),
	page: required(page),
	activity: required(list(activity)),
	retryable: required(boolean),
	error: optional((value) =>
		typeof value === "string" && value !== "" ? value : undefined,
	),
});

/**
 * Narrow one poll's answer.
 *
 * The wire is opaque JSON, so an answer this version does not recognize — an
 * older host, or a newer one with a field this half has not learned — is
 * answered with `undefined` and reported, rather than drawn as a half-page.
 * @param value - the parsed body.
 * @returns the snapshot, or undefined when it is not one this half reads.
 */
export function asPanelSnapshot(value: unknown): PanelSnapshot | undefined {
	if (!isRecord(value) || !Array.isArray(value.activity)) return undefined;

	return snapshot(value);
}

/** Why a thrown value reads as, as one sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Watch one session's browser by asking the host for it.
 *
 * The next poll is scheduled after the previous answer settles, so a slow host
 * delays the interval instead of stacking requests behind it. A failure keeps
 * what was last known and reports it: a panel that has gone quiet should still
 * show the page it was on, and say why it stopped.
 * @param session - the agent-browser session to watch, or undefined to watch none.
 * @param visible - whether this panel's tab is the one on screen; a kept-mounted
 *   tab behind another one must cost no frames.
 * @returns the host's last answer, whether reaching it failed, and how to ask sooner.
 */
export const useBrowserPanel = (
	session: string | undefined,
	visible = true,
): BrowserPanelWatch => {
	const [panel, setPanel] = useState<BrowserPanelState>(EMPTY);
	const askSoon = useRef<() => void>(() => {});
	const isVisible = useRef(visible);

	isVisible.current = visible;

	useEffect(() => {
		setPanel(EMPTY);

		if (session === undefined) return;

		let stopped = false;
		let asking = false;
		let timer: number | undefined;

		const schedule = (): void => {
			if (stopped || document.hidden || !isVisible.current) return;

			timer = window.setTimeout(() => void ask(), POLL_MS);
		};

		const ask = async (): Promise<void> => {
			if (asking) return;

			asking = true;
			timer = undefined;

			try {
				const response = await fetch(panelUrl(session), {
					headers: { accept: "application/json" },
				});

				if (!response.ok)
					throw new Error(`${response.status} ${response.statusText}`);

				const snapshot = asPanelSnapshot(await response.json());

				if (stopped) return;

				setPanel(
					snapshot === undefined
						? {
								snapshot: undefined,
								error: "the host answered something this version cannot read",
							}
						: { snapshot, error: snapshot.error },
				);
			} catch (error) {
				if (!stopped)
					setPanel((current) => ({
						...current,
						error: `The browser plugin's host half is not answering: ${messageOf(error)}`,
					}));
			} finally {
				asking = false;
				schedule();
			}
		};

		const wake = (): void => {
			if (stopped || document.hidden || !isVisible.current) return;

			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
			}

			void ask();
		};

		const onVisibility = (): void => {
			if (!document.hidden) wake();
		};

		askSoon.current = wake;
		document.addEventListener("visibilitychange", onVisibility);

		void ask();

		return () => {
			stopped = true;
			askSoon.current = () => {};
			document.removeEventListener("visibilitychange", onVisibility);

			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session]);

	useEffect(() => {
		if (visible) askSoon.current();
	}, [visible]);

	return { ...panel, refresh: useCallback(() => askSoon.current(), []) };
};

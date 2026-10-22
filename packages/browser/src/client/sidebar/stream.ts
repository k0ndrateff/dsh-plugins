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
 * Half a second is the interval: fast enough that a person watching sees the
 * agent's work as it happens, slow enough that a page which has not moved costs
 * one small answer each time. The picture is a separate request — an `<img>`
 * pointed at the frame route, keyed by the sequence the poll reported — so the
 * bytes never pass through JSON.
 */

import { useEffect, useState } from "react";
import {
	type PanelActivity,
	type PanelSnapshot,
	panelUrl,
} from "../../shared/panel";

/** How often one mounted panel asks. */
export const POLL_MS = 500;

/** Everything the panel currently knows about one browser. */
export interface BrowserPanelState {
	/** The host's last answer, or undefined until one arrives. */
	readonly snapshot: PanelSnapshot | undefined;
	/** Why the host could not be reached, or undefined when it could. */
	readonly error: string | undefined;
}

/** What the panel knows before the first answer. */
const EMPTY: BrowserPanelState = { snapshot: undefined, error: undefined };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asActivity = (value: unknown): PanelActivity | undefined => {
	if (!isRecord(value)) return undefined;

	const kind = value.kind;
	const text = asString(value.text);
	const at = asNumber(value.at);

	if ((kind !== "command" && kind !== "result") || text === undefined)
		return undefined;
	if (at === undefined) return undefined;

	return { kind, text, at };
};

/**
 * Narrow one poll's answer.
 *
 * The wire is opaque JSON, so an answer this version does not recognize — an
 * older host, or a newer one with a field this half has not learned — is
 * answered with `undefined` and reported, rather than drawn as a half-page.
 * @param value - the parsed body.
 * @returns the snapshot, or undefined when it is not one this half reads.
 */
export const asPanelSnapshot = (value: unknown): PanelSnapshot | undefined => {
	if (!isRecord(value)) return undefined;

	const session = asString(value.session);
	const connected = value.connected;
	const url = asString(value.url);
	const title = asString(value.title);
	const error = asString(value.error);
	const seq = asNumber(value.seq);

	if (
		session === undefined ||
		typeof connected !== "boolean" ||
		url === undefined ||
		title === undefined ||
		seq === undefined ||
		!Array.isArray(value.activity)
	)
		return undefined;

	const activity: PanelActivity[] = [];
	for (const candidate of value.activity) {
		const item = asActivity(candidate);
		if (item !== undefined) activity.push(item);
	}

	return {
		session,
		connected,
		url,
		title,
		seq,
		activity,
		...(error === undefined || error === "" ? {} : { error }),
	};
};

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
 * @returns the host's last answer, and whether reaching it failed.
 */
export const useBrowserPanel = (
	session: string | undefined,
): BrowserPanelState => {
	const [panel, setPanel] = useState<BrowserPanelState>(EMPTY);

	useEffect(() => {
		setPanel(EMPTY);

		if (session === undefined) return;

		let stopped = false;
		let timer: number | undefined;

		const poll = async (): Promise<void> => {
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
					setPanel((current) => ({ ...current, error: messageOf(error) }));
			} finally {
				if (!stopped) timer = window.setTimeout(() => void poll(), POLL_MS);
			}
		};

		void poll();

		return () => {
			stopped = true;

			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session]);

	return panel;
};

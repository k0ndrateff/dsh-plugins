/**
 * The live viewport, as one WebSocket per mounted panel.
 *
 * The panel talks to its own origin — `/dsh-browser/stream` — rather than to the
 * agent-browser daemon's port, because only the host half may hold the upgrade:
 * the GUI is not always served from loopback, and the daemon's origin policy is
 * not ours to depend on.
 *
 * The host answers in three message shapes, and this narrows each one instead of
 * trusting it: the frame's `width`/`height` are the *viewport's*, not the
 * image's, so the picture is laid out by the panel and the numbers are kept for
 * whoever later needs to translate a click.
 *
 * A panel is mounted before the host has a browser to show — the agent may not
 * have called `browser_open` yet — so a socket that cannot be established, or
 * one the host drops, is retried on a short backoff rather than reported as a
 * failure. Everything the hook knows lives in the returned state; the narrowing,
 * the URL, and the backoff are pure functions beside it so each can be read on
 * its own.
 */

import { useEffect, useState } from "react";
import {
	type PanelActivity,
	type PanelMessage,
	streamUrl,
} from "../../shared/panel";

/** The host's own state, as the panel reads it. */
export type BrowserState = Extract<PanelMessage, { type: "state" }>;

/** One viewport frame: a base64 JPEG, and the size of what it shows. */
export type BrowserFrame = Extract<PanelMessage, { type: "frame" }>;

/** One thing the agent did in the browser, or what it got back. */
export type BrowserActivityItem = PanelActivity;

/** Everything the panel currently knows about one browser. */
export interface BrowserStream {
	/** The browser's own state, or undefined until the host has said anything. */
	readonly state: BrowserState | undefined;
	/** The last frame received, or undefined before the first one. */
	readonly frame: BrowserFrame | undefined;
	/** The activity the host last reported, newest last. */
	readonly activity: readonly BrowserActivityItem[];
	/** What the host last refused or lost, or undefined when it has not. */
	readonly error: string | undefined;
}

/** How long the first retry waits, doubling from there. */
const BACKOFF_BASE_MS = 500;

/** The ceiling a retry waits, so a host that is down is still noticed. */
const BACKOFF_MAX_MS = 4000;

/** What the panel knows before the host has said anything. */
const EMPTY_STREAM: BrowserStream = {
	state: undefined,
	frame: undefined,
	activity: [],
	error: undefined,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asState = (value: Record<string, unknown>): BrowserState | undefined => {
	const session = asString(value.session);
	const connected = value.connected;
	const url = asString(value.url);
	const title = asString(value.title);
	const error = asString(value.error);

	if (
		session === undefined ||
		typeof connected !== "boolean" ||
		url === undefined ||
		title === undefined
	)
		return undefined;

	return {
		type: "state",
		session,
		connected,
		url,
		title,
		...(error === undefined || error === "" ? {} : { error }),
	};
};

const asFrame = (value: Record<string, unknown>): BrowserFrame | undefined => {
	const seq = asNumber(value.seq);
	const width = asNumber(value.width);
	const height = asNumber(value.height);
	const data = asString(value.data);

	if (
		seq === undefined ||
		width === undefined ||
		height === undefined ||
		data === undefined
	)
		return undefined;

	return { type: "frame", seq, width, height, data };
};

const asActivityItem = (value: unknown): BrowserActivityItem | undefined => {
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
 * Narrow one text frame the host sent.
 *
 * The wire is opaque JSON, so a message this version does not recognize — an
 * older host, or a newer one with a shape this half has not learned — is
 * answered with `undefined` and dropped rather than allowed to break the panel.
 * @param value - the parsed frame.
 * @returns the message, or undefined when it is not one this half reads.
 */
export const asStreamMessage = (value: unknown): PanelMessage | undefined => {
	if (!isRecord(value)) return undefined;

	switch (value.type) {
		case "state":
			return asState(value);
		case "frame":
			return asFrame(value);
		case "activity": {
			if (!Array.isArray(value.items)) return undefined;

			const items: BrowserActivityItem[] = [];
			for (const candidate of value.items) {
				const item = isRecord(candidate)
					? asActivityItem(candidate)
					: undefined;
				if (item !== undefined) items.push(item);
			}

			return { type: "activity", items };
		}
		default:
			return undefined;
	}
};

/**
 * How long to wait before the retry after a given attempt.
 *
 * Doubling from half a second and capped at four: a panel opened before the
 * agent's first call reconnects in well under a second, while a host that is
 * gone for a while is asked once every few seconds instead of in a loop.
 * @param attempt - how many attempts have already failed; negative reads as none.
 * @returns the delay in milliseconds.
 */
export const nextBackoff = (attempt: number): number =>
	Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));

/** Fold one message into what the panel knows. */
const reduced = (
	current: BrowserStream,
	message: PanelMessage,
): BrowserStream => {
	switch (message.type) {
		case "state":
			// A fresh state is the host speaking again, so a refusal it reported
			// earlier is no longer the latest word about this browser.
			return { ...current, state: message, error: message.error };
		case "frame":
			return { ...current, frame: message };
		case "activity":
			return { ...current, activity: message.items };
	}
};

/**
 * Watch one session's browser, reconnecting while the panel is mounted.
 *
 * A change of session — or a panel opened without one — closes the socket and
 * forgets everything, because the next frame belongs to a different browser.
 * @param session - the agent-browser session to watch, or undefined to watch none.
 * @returns the state, the last frame, the activity, and the host's last refusal.
 */
export const useBrowserStream = (
	session: string | undefined,
): BrowserStream => {
	const [stream, setStream] = useState<BrowserStream>(EMPTY_STREAM);

	useEffect(() => {
		setStream(EMPTY_STREAM);

		if (session === undefined) return;

		let socket: WebSocket | undefined;
		let timer: number | undefined;
		let attempt = 0;
		let isClosed = false;

		const receive = (event: MessageEvent): void => {
			if (typeof event.data !== "string") return;

			let payload: unknown;
			try {
				payload = JSON.parse(event.data);
			} catch {
				return;
			}

			const message = asStreamMessage(payload);
			if (message === undefined) return;

			setStream((current) => reduced(current, message));
		};

		const schedule = (): void => {
			timer = window.setTimeout(connect, nextBackoff(attempt));
			attempt += 1;
		};

		const connect = (): void => {
			const opened = new WebSocket(streamUrl(window.location.origin, session));

			opened.onopen = () => {
				attempt = 0;
			};
			opened.onmessage = receive;
			// A refused handshake is an error followed by a close, and the close is
			// what schedules the retry; a handler here would double every delay.
			opened.onerror = null;
			opened.onclose = () => {
				if (!isClosed) schedule();
			};

			socket = opened;
		};

		connect();

		return () => {
			isClosed = true;
			if (timer !== undefined) window.clearTimeout(timer);

			if (socket !== undefined) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
		};
	}, [session]);

	return stream;
};

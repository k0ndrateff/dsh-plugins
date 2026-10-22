/**
 * One session's live view: the host's side of a panel.
 *
 * Exactly one connection watches a session's screencast, and every open panel is
 * a subscriber to what that connection last saw. Three decisions live here and
 * nowhere else:
 *
 *  - the connection exists only while somebody is watching, and ends a while
 *    after the last reader leaves — frames cost the browser real work, and a
 *    closed panel must not pay for them;
 *  - a session is watched only once a tool call has proved there is a browser in
 *    it, so opening a panel never starts one;
 *  - the feed keeps the CLI's own pairs — a command line, then its outcome — and
 *    only the last few, because a feed nobody scrolls is not a log.
 */

import type { PanelActivity, PanelMessage } from "../../shared/panel";
import { errorText } from "../text";
import type { WirePeer } from "../wire/peer";
import {
	parseStreamMessage,
	type StreamActivity,
	type StreamFrame,
} from "./events";

/** How long the connection is kept after the last reader leaves. */
const DEFAULT_IDLE_MS = 10_000;

/** How many activity lines one reader is shown. */
const DEFAULT_ACTIVITY_LIMIT = 40;

/** The most frames per second this reader asks the screencast for. */
const DEFAULT_MAX_FPS = 8;

/** How many times one burst of attempts is retried before it waits for a tool. */
const MAX_ATTEMPTS = 3;

/** The first retry delay, and the longest one. */
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8_000;

/** What a reader is told when nothing has driven this session yet. */
const NO_BROWSER_YET =
	"this session has no browser yet: open a page with browser_open";

/** What one hub needs from the plugin. */
export interface StreamHubDeps {
	/** The agent-browser session this hub watches. */
	readonly session: string;
	/** Where that session's screencast listens, once there is a browser. */
	readonly port: () => Promise<number | undefined>;
	/** Open one connection to that port. */
	readonly connect: (
		port: number,
		handlers: {
			onMessage: (text: string) => void;
			onClose: (reason: string) => void;
		},
	) => Promise<WirePeer>;
	readonly idleMs?: number;
	readonly activityLimit?: number;
	readonly maxFps?: number;
}

export class StreamHub {
	private readonly listeners = new Set<(message: PanelMessage) => void>();
	private peer: WirePeer | undefined;
	private idle: NodeJS.Timeout | undefined;
	private retry: NodeJS.Timeout | undefined;
	private attempts = 0;
	private opening = false;
	private closing = false;
	private watching = false;
	private connected = false;
	private url = "";
	private title = "";
	private failure: string | undefined;
	private frame: StreamFrame | undefined;
	private activity: PanelActivity[] = [];

	/** @param deps - the session, where to find its screencast, and its caps. */
	constructor(private readonly deps: StreamHubDeps) {}

	/** Whether a browser has been seen in this session and not closed since. */
	get watched(): boolean {
		return this.watching;
	}

	/** Whether the screencast connection is open right now. */
	get live(): boolean {
		return this.peer !== undefined;
	}

	/**
	 * Watch this session's browser.
	 * @param listener - told everything that changes; what is already known
	 *   arrives immediately, so an opening panel draws before the next frame.
	 * @returns the unsubscribe, which starts the idle countdown when it is last.
	 */
	watch(listener: (message: PanelMessage) => void): () => void {
		this.listeners.add(listener);

		// A panel that opens before anything has driven this session is told so in
		// its very first message, rather than left to read an empty page as a blank.
		if (!this.watching && this.failure === undefined)
			this.failure = NO_BROWSER_YET;

		listener(this.stateMessage());

		if (this.frame !== undefined) listener({ type: "frame", ...this.frame });
		if (this.activity.length > 0)
			listener({ type: "activity", items: [...this.activity] });

		this.cancelIdle();
		if (this.watching) void this.open();

		return () => {
			this.listeners.delete(listener);

			if (this.listeners.size === 0) this.armIdle();
		};
	}

	/** A tool call proved this session has a browser. */
	markLive(): void {
		this.watching = true;
		this.attempts = 0;
		this.failure = undefined;
		void this.open();
	}

	/** The browser was closed on purpose, so it is not worth looking for. */
	markClosed(): void {
		this.watching = false;
		this.cancelRetry();
		this.drop("this session's browser was closed");
	}

	/** Stop for good: the plugin is going away. */
	stop(): void {
		this.listeners.clear();
		this.watching = false;
		this.cancelIdle();
		this.cancelRetry();
		this.drop("the plugin was unloaded");
	}

	/** Open the screencast, when there is a reason to and nobody else is. */
	private async open(): Promise<void> {
		if (
			this.opening ||
			this.peer !== undefined ||
			!this.watching ||
			this.listeners.size === 0
		)
			return;

		this.opening = true;

		try {
			const port = await this.deps.port();

			if (this.listeners.size === 0 || !this.watching) return;

			if (port === undefined) {
				this.gave("no browser is running in this session");

				return;
			}

			this.peer = await this.deps.connect(port, {
				onMessage: (text) => this.receive(text),
				onClose: (reason) => this.lose(reason),
			});
			this.attempts = 0;
			this.connected = true;
			this.failure = undefined;
			this.emitState();
			// One bounded frame rate for our reader: the screencast ticks per client.
			this.peer.send(
				JSON.stringify({
					type: "config",
					maxFps: this.deps.maxFps ?? DEFAULT_MAX_FPS,
				}),
			);
		} catch (error) {
			this.gave(errorText(error));
		} finally {
			this.opening = false;
		}
	}

	/** One message from the screencast, as something worth telling readers. */
	private receive(text: string): void {
		const event = parseStreamMessage(text);

		if (event === undefined) return;

		switch (event.kind) {
			case "address": {
				const title = event.title ?? this.title;

				if (event.url === this.url && title === this.title) return;

				this.url = event.url;
				this.title = title;
				this.emitState();

				return;
			}

			case "frame": {
				this.frame = event.frame;
				this.emit({ type: "frame", ...event.frame });

				return;
			}

			case "activity": {
				this.remember(event.activity);

				return;
			}
		}
	}

	/** One line of the feed, and the window it belongs to. */
	private remember(activity: StreamActivity): void {
		const limit = this.deps.activityLimit ?? DEFAULT_ACTIVITY_LIMIT;

		this.activity = [
			...this.activity,
			{ kind: activity.kind, text: activity.text, at: activity.at },
		].slice(-limit);
		this.emit({ type: "activity", items: [...this.activity] });
	}

	/** The screencast ended on its own. */
	private lose(reason: string): void {
		if (this.closing) return;

		this.peer = undefined;
		this.connected = false;
		this.frame = undefined;
		this.activity = [];
		this.gave(reason);
	}

	/** End the connection because we decided to, not because it broke. */
	private drop(reason: string): void {
		const peer = this.peer;

		this.peer = undefined;
		this.closing = true;

		try {
			peer?.close(reason);
		} finally {
			this.closing = false;
		}

		this.connected = false;
		this.frame = undefined;
		this.activity = [];
		this.failure = reason;
		this.emitState();
	}

	/** Nothing to watch, and why; retried a few times, then left to a tool call. */
	private gave(reason: string): void {
		this.connected = false;
		this.failure = reason;
		this.emitState();
		this.attempts += 1;

		if (this.attempts < MAX_ATTEMPTS) this.scheduleRetry();
	}

	/** One more attempt, further away than the last. */
	private scheduleRetry(): void {
		if (this.retry !== undefined || this.listeners.size === 0 || !this.watching)
			return;

		const delay = Math.min(
			RETRY_BASE_MS * 2 ** (this.attempts - 1),
			RETRY_CAP_MS,
		);

		this.retry = setTimeout(() => {
			this.retry = undefined;
			void this.open();
		}, delay);
		this.retry.unref();
	}

	/** Stop watching a while after the last reader left. */
	private armIdle(): void {
		this.cancelIdle();
		this.idle = setTimeout(() => {
			this.idle = undefined;
			this.drop("nobody is watching");
		}, this.deps.idleMs ?? DEFAULT_IDLE_MS);
		this.idle.unref();
	}

	private cancelIdle(): void {
		if (this.idle === undefined) return;

		clearTimeout(this.idle);
		this.idle = undefined;
	}

	private cancelRetry(): void {
		if (this.retry === undefined) return;

		clearTimeout(this.retry);
		this.retry = undefined;
	}

	/** The state one reader sees, as a message. */
	private stateMessage(): PanelMessage {
		return {
			type: "state",
			session: this.deps.session,
			connected: this.connected,
			url: this.url,
			title: this.title,
			...(this.failure === undefined || this.connected
				? {}
				: { error: this.failure }),
		};
	}

	private emitState(): void {
		this.emit(this.stateMessage());
	}

	/** One message to every reader; a reader that throws is not the others' problem. */
	private emit(message: PanelMessage): void {
		for (const listener of this.listeners) {
			try {
				listener(message);
			} catch {
				// A panel that fails to draw must not stop the next one from hearing.
			}
		}
	}
}

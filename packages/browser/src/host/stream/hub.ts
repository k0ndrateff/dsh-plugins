/**
 * One session's live view: the host's side of a panel.
 *
 * Exactly one connection watches a session's screencast, and every poll of the
 * panel is answered from what that connection last saw. Three decisions live here
 * and nowhere else:
 *
 *  - the connection exists only while somebody is asking, and ends a while after
 *    the last poll — frames cost the browser real work, and a closed panel must
 *    not pay for them;
 *  - a session is watched only once a tool call has proved there is a browser in
 *    it, so opening a panel never starts one;
 *  - the feed keeps the CLI's own pairs — a command line, then its outcome —
 *    plus what the person at the panel did, and only the last few, because a
 *    feed nobody scrolls is not a log.
 */

import type {
	PanelActivity,
	PanelInput,
	PanelPage,
	PanelSnapshot,
	PanelState,
} from "../../shared/panel";
import { errorText } from "../text";
import type { WirePeer } from "../wire/peer";
import {
	parseStreamMessage,
	type StreamActivity,
	type StreamFrame,
} from "./events";
import { humanLineOf, noteOf, wireMessagesOf } from "./input";

/** How long the connection is kept after the last poll. */
const DEFAULT_IDLE_MS = 10_000;

/** How many activity lines one reader is shown. */
const DEFAULT_ACTIVITY_LIMIT = 40;

/** How many of a person's acts are kept for the agent to be told about. */
const PENDING_LIMIT = 12;

/** How many commands may be waiting for an outcome before the window is dropped. */
const COMMAND_WINDOW = 256;

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
	/** Ask the page how big it is; nothing is measured against a guess. */
	readonly page?: () => Promise<PanelPage | undefined>;
	readonly idleMs?: number;
	readonly activityLimit?: number;
	readonly maxFps?: number | (() => number);
}

export class StreamHub {
	private peer: WirePeer | undefined;
	private idle: NodeJS.Timeout | undefined;
	private retry: NodeJS.Timeout | undefined;
	private attempts = 0;
	private opening = false;
	private closing = false;
	/** Bumped whenever the connection is dropped, to invalidate a late connect. */
	private generation = 0;
	private watching = false;
	private connected = false;
	private url = "";
	private title = "";
	private failure: string | undefined;
	private frame: StreamFrame | undefined;
	private page: PanelPage = { width: 0, height: 0 };
	/** The window the last frame was taken in, for noticing a relayout. */
	private device = { width: 0, height: 0 };
	private activity: PanelActivity[] = [];
	/** What the person did and the agent has not been told yet. */
	private pending: string[] = [];
	/** Commands whose outcome this feed can still place. */
	private commanding = new Set<string>();

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

	/** A tool call proved this session has a browser. */
	markLive(): void {
		this.watching = true;
		this.attempts = 0;
		this.failure = undefined;
	}

	/** The browser was closed on purpose, so it is not worth looking for. */
	markClosed(): void {
		this.watching = false;
		this.cancelRetry();
		this.drop("this session's browser was closed");
	}

	/**
	 * One poll arrived: keep the view alive, and start it when there is one.
	 *
	 * Starting here rather than on `markLive` is what keeps a browser the panel
	 * never asked about from being watched: a tool that ran and no panel to look
	 * at it costs nothing.
	 */
	touch(): void {
		this.armIdle();

		if (!this.watching) {
			// A panel that opens before anything has driven this session is told so,
			// rather than left to read an empty page as a blank.
			if (this.failure === undefined) this.failure = NO_BROWSER_YET;

			return;
		}

		void this.open();
	}

	/** What one poll answers with. */
	snapshot(): PanelSnapshot {
		return {
			session: this.deps.session,
			connected: this.connected,
			url: this.url,
			title: this.title,
			...(this.failure === undefined || this.connected
				? {}
				: { error: this.failure }),
			seq: this.frame?.seq ?? 0,
			page: this.page,
			activity: [...this.activity],
		};
	}

	/**
	 * One act of the person at the panel, forwarded to the page.
	 *
	 * Sent through the connection the panel already has rather than through a new
	 * CLI call: an input event is a message on the same socket, and a click that
	 * waited for a process to start would not feel like a click.
	 * @param input - what the person did.
	 * @returns false when there is no connection to carry it.
	 */
	sendInput(input: PanelInput): boolean {
		const peer = this.peer;

		if (peer === undefined) return false;

		for (const message of wireMessagesOf(input))
			peer.send(JSON.stringify(message));

		const line = humanLineOf(input);

		if (line !== undefined)
			this.remember({ kind: "human", text: line, at: Date.now() });

		const note = noteOf(input);

		if (note !== undefined) this.note(note);

		return true;
	}

	/**
	 * Ask the page for its own size again.
	 *
	 * A viewport command changes `innerWidth/Height` without changing the frame
	 * window's metadata, so the frame-driven remeasure never sees it.
	 */
	async remeasure(): Promise<void> {
		await this.measure();
	}

	/**
	 * Whether this conversation has a browser, and where it was last seen.
	 *
	 * Read by the chip above the chat, which exists to bring a closed panel back:
	 * it says nothing about frames, and asking it must not cost one.
	 */
	state(): PanelState {
		return { open: this.watching, url: this.url, title: this.title };
	}

	/** The last frame, for a reader that does not have it yet. */
	latestFrame(): StreamFrame | undefined {
		return this.frame;
	}

	/** Stop for good: the plugin is going away. */
	stop(): void {
		this.watching = false;
		this.pending = [];
		this.cancelIdle();
		this.cancelRetry();
		this.drop("the plugin was unloaded");
	}

	/** Open the screencast, when there is a reason to and nobody else is. */
	private async open(): Promise<void> {
		if (
			this.opening ||
			this.peer !== undefined ||
			this.retry !== undefined ||
			this.attempts >= MAX_ATTEMPTS ||
			!this.watching
		)
			return;

		this.opening = true;
		const generation = this.generation;

		try {
			const port = await this.deps.port();

			if (!this.watching) return;

			if (port === undefined) {
				this.gave("no browser is running in this session");

				return;
			}

			const peer = await this.deps.connect(port, {
				onMessage: (text) => this.receive(text),
				onClose: (reason) => this.lose(reason),
			});

			// The panel may have been closed, or the plugin unloaded, while the
			// socket was being negotiated. The peer that arrived afterwards belongs
			// to nobody and must not keep the screencast alive.
			if (!this.watching || this.generation !== generation) {
				peer.close("the live view closed while connecting");

				return;
			}

			this.peer = peer;
			this.attempts = 0;
			this.connected = true;
			this.failure = undefined;
			// One bounded frame rate for our reader: the screencast ticks per client.
			this.peer.send(
				JSON.stringify({
					type: "config",
					maxFps:
						typeof this.deps.maxFps === "function"
							? this.deps.maxFps()
							: (this.deps.maxFps ?? DEFAULT_MAX_FPS),
				}),
			);
			void this.measure();
		} catch (error) {
			this.gave(errorText(error));
		} finally {
			this.opening = false;
		}
	}

	/** One message from the screencast, as something worth reporting. */
	private receive(text: string): void {
		const event = parseStreamMessage(text);

		if (event === undefined) return;

		switch (event.kind) {
			case "address": {
				this.url = event.url;
				this.title = event.title ?? this.title;

				return;
			}

			case "frame": {
				this.frame = event.frame;
				this.remeasured(event.frame);

				return;
			}

			case "activity": {
				this.placed(event.activity);

				return;
			}
		}
	}

	/**
	 * Remember one act of the person at the panel, for the agent to be told.
	 *
	 * Kept apart from the feed on purpose: the feed is what a reader is looking
	 * at right now, while this waits for the agent's next tool call — and it
	 * outlives a panel that closes, because the page did not go back.
	 * @param note - the act, as one clause of a sentence.
	 */
	note(note: string): void {
		this.pending = [...this.pending, note].slice(-PENDING_LIMIT);
	}

	/**
	 * What the person did since the last tool call, and nothing afterwards.
	 *
	 * One tool call takes the whole sentence: the next call in the same turn has
	 * nothing to add, and a note repeated in five results is a note a model
	 * learns to skip.
	 * @returns the sentence, or undefined when the person has not touched the page.
	 */
	takeNote(): string | undefined {
		const acts = this.pending;

		this.pending = [];

		if (acts.length === 0) return undefined;

		const shown = acts.slice(-4);
		const rest = acts.length - shown.length;
		const list = shown.join("; ");

		return [
			`The person at the panel used this browser since your last call: ${list}${rest > 0 ? `; and ${rest} more` : ""}.`,
			"The page may have moved, reflowed or changed size since you last saw it: take a fresh snapshot before acting on earlier references.",
		].join("\n");
	}

	/**
	 * Ask the page how big it is, when the answer can have changed.
	 *
	 * A window the browser reports is not the page inside it, so this is the only
	 * honest source of the coordinates a click is measured in. It costs one CLI
	 * call per connection and per relayout, and nothing at all when the page is
	 * left alone.
	 */
	private async measure(): Promise<void> {
		const ask = this.deps.page;

		if (ask === undefined || this.peer === undefined) return;

		const page = await ask();

		// A connection that ended while the page was being asked has nothing to
		// measure: the answer belongs to a browser this panel is no longer showing.
		if (page === undefined || this.peer === undefined) return;

		this.page = page;
	}

	/** Notice a frame taken in a different window, which means a relayout. */
	private remeasured(frame: StreamFrame): void {
		if (
			frame.width === this.device.width &&
			frame.height === this.device.height
		)
			return;

		this.device = { width: frame.width, height: frame.height };
		void this.measure();
	}

	/**
	 * One feed line, if its pair belongs together.
	 *
	 * An outcome whose command nobody saw — dropped as this plugin's own probe,
	 * or older than this connection — has nothing to say: the line it would join
	 * is not there, and folded onto the previous one it would report that
	 * command's duration as its own.
	 */
	private placed(activity: StreamActivity): void {
		if (activity.kind === "command") {
			if (this.commanding.size > COMMAND_WINDOW) this.commanding.clear();

			this.commanding.add(activity.id);
			this.remember(activity);

			return;
		}

		if (!this.commanding.delete(activity.id)) return;

		this.remember(activity);
	}

	/** One line of the feed, and the window it belongs to. */
	private remember(line: {
		readonly kind: PanelActivity["kind"];
		readonly text: string;
		readonly at: number;
	}): void {
		const limit = this.deps.activityLimit ?? DEFAULT_ACTIVITY_LIMIT;

		this.activity = [
			...this.activity,
			{ kind: line.kind, text: line.text, at: line.at },
		].slice(-limit);
	}

	/** The screencast ended on its own. */
	private lose(reason: string): void {
		if (this.closing) return;

		this.peer = undefined;
		this.connected = false;
		this.frame = undefined;
		this.page = { width: 0, height: 0 };
		this.activity = [];
		this.gave(reason);
	}

	/** End the connection because we decided to, not because it broke. */
	private drop(reason: string): void {
		const peer = this.peer;

		this.generation += 1;
		this.peer = undefined;
		this.closing = true;

		try {
			peer?.close(reason);
		} finally {
			this.closing = false;
		}

		this.connected = false;
		this.frame = undefined;
		this.page = { width: 0, height: 0 };
		this.activity = [];
		this.failure = reason;
	}

	/** Nothing to watch, and why; retried a few times, then left to a tool call. */
	private gave(reason: string): void {
		this.connected = false;
		this.failure = reason;
		this.attempts += 1;

		if (this.attempts < MAX_ATTEMPTS) this.scheduleRetry();
	}

	/** One more attempt, further away than the last. */
	private scheduleRetry(): void {
		if (this.retry !== undefined || !this.watching) return;

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

	/** Stop watching a while after the last poll. */
	private armIdle(): void {
		this.cancelIdle();
		this.idle = setTimeout(() => {
			this.idle = undefined;

			if (!this.watching) return;

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
}

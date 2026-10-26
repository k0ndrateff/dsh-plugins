/**
 * One session's live view: the host's side of a panel.
 *
 * Exactly one connection watches a session's screencast, and every poll of the
 * panel is answered from what that connection last saw. Four decisions live here
 * and nowhere else:
 *
 *  - the connection exists only while somebody is asking, and ends a while after
 *    the last poll — frames cost the browser real work, and a closed panel must
 *    not pay for them;
 *  - a session is watched only once a tool call has proved there is a browser in
 *    it, so opening a panel never starts one;
 *  - a browser that is not on screen right now is a *state*, not an error: not
 *    opened yet, closed, paused because nobody was looking, or reconnecting are
 *    answered as neutral sentences, and only a failed connection is red;
 *  - the feed keeps the CLI's own pairs — a command line, then its outcome —
 *    plus what the person at the panel did, and only the last few, because a
 *    feed nobody scrolls is not a log.
 */

import type {
	PanelActivity,
	PanelInput,
	PanelPage,
	PanelPhase,
	PanelSnapshot,
	PanelState,
	PanelTab,
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

/** How long a person's typing is collected into one feed line. */
const TYPING_SETTLE_MS = 400;

/** How long the host waits for the command a person's own action caused. */
const ANNOUNCE_MS = 10_000;

/** What a panel says when this conversation never opened a browser. */
const NOTHING_OPEN =
	"Nothing has been opened in this conversation's browser yet. The agent opens one when it needs a page.";

/** What a panel says when the browser was closed on purpose. */
const CLOSED =
	"The browser was closed. Ask the agent to open a page when you need it again.";

/** What a panel says while the host is connecting to a browser. */
const CONNECTING = "Connecting to the browser…";

/** What a panel says when the session claims a browser that is not running. */
const NOT_RUNNING =
	"No browser is running in this conversation right now. If the agent is still working, it opens one on its next page.";

/** What a panel says when the idle connection was dropped and can come back. */
const PAUSED =
	"The live view paused while nobody was looking. It reconnects when the panel is shown again; the last picture and activity are kept below.";

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

/** A person's action whose CLI command the feed should read as theirs. */
interface Announced {
	readonly action: string;
	readonly text: string;
	readonly until: number;
}

export class StreamHub {
	private peer: WirePeer | undefined;
	private idle: NodeJS.Timeout | undefined;
	private retryTimer: NodeJS.Timeout | undefined;
	private typingTimer: NodeJS.Timeout | undefined;
	private attempts = 0;
	private opening = false;
	private closing = false;
	/** Bumped whenever the connection is dropped, to invalidate a late connect. */
	private generation = 0;
	private watching = false;
	private connected = false;
	private phase: PanelPhase = "none";
	private message = NOTHING_OPEN;
	private error: string | undefined;
	private paused = false;
	private url = "";
	private title = "";
	private tabs: PanelTab[] = [];
	private frame: StreamFrame | undefined;
	private page: PanelPage = { width: 0, height: 0 };
	/** The window the last frame was taken in, for noticing a relayout. */
	private device = { width: 0, height: 0 };
	private activity: PanelActivity[] = [];
	/** What the person did and the agent has not been told yet. */
	private pending: string[] = [];
	/** The letters of the current burst of typing, or empty. */
	private typing = "";
	/** The person's actions whose CLI command the feed should read as theirs. */
	private announced: Announced[] = [];
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
		this.error = undefined;
		this.paused = false;

		if (this.connected) {
			this.phase = "live";
			this.message = "";

			return;
		}

		if (this.phase !== "starting") {
			this.phase = "starting";
			this.message = CONNECTING;
		}
	}

	/** The browser was closed on purpose, so it is not worth looking for. */
	markClosed(): void {
		this.watching = false;
		this.attempts = 0;
		this.paused = false;
		this.cancelRetry();
		this.flushTyping();
		this.announced = [];
		this.closePeer("the browser was closed");

		this.connected = false;
		this.phase = "closed";
		this.message = CLOSED;
		this.url = "";
		this.title = "";
		this.tabs = [];
		this.frame = undefined;
		this.page = { width: 0, height: 0 };
		// The activity is kept on purpose: what happened before a close is still
		// the answer to "what did the agent do" when the panel comes back.
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

		if (!this.watching) return;

		// The budget is spent and the panel already says so: polling must not turn
		// that into a "Connecting…" that never connects. Retry is the way back.
		if (this.attempts >= MAX_ATTEMPTS) return;

		if (this.paused || this.phase === "none") {
			this.paused = false;
			this.phase = "starting";
			this.message = CONNECTING;
		}

		void this.open();
	}

	/** What one poll answers with. */
	snapshot(): PanelSnapshot {
		return {
			session: this.deps.session,
			phase: this.phase,
			message: this.message,
			connected: this.connected,
			open: this.watching,
			paused: this.paused,
			url: this.url,
			title: this.title,
			tabs: [...this.tabs],
			...(this.error === undefined ? {} : { error: this.error }),
			retryable:
				this.watching &&
				(this.phase === "none" || this.phase === "unreachable"),
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

		this.rememberHuman(input);

		return true;
	}

	/**
	 * Let the feed read the CLI's next command as the person's own.
	 *
	 * A navigation or a page size is run by the host as a CLI command, and the
	 * screencast reports it like any other command — as if the agent had done it.
	 * Announcing the action here lets the feed put the person's name on the line
	 * instead.
	 * @param action - the CLI action the next command will carry.
	 * @param text - what the person's line says.
	 */
	announce(action: string, text: string): void {
		this.announced = [
			...this.announced,
			{ action, text, until: Date.now() + ANNOUNCE_MS },
		].slice(-8);
	}

	/** Forget announced actions that will never arrive. */
	clearAnnouncements(): void {
		this.announced = [];
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
	 * Try again after the retry budget ran out.
	 *
	 * Explicit rather than implicit on `touch()`: a panel that polls five times a
	 * second must not turn a broken connection into a connect loop.
	 */
	retry(): void {
		this.attempts = 0;
		this.cancelRetry();
		this.error = undefined;

		if (!this.watching) {
			this.phase = "none";
			this.message = NOTHING_OPEN;

			return;
		}

		this.paused = false;
		this.phase = "starting";
		this.message = CONNECTING;
		void this.open();
	}

	/**
	 * Whether this conversation has a browser, and where it was last seen.
	 *
	 * Read by the chip above the chat, which exists to bring a closed panel back:
	 * it says nothing about frames, and asking it must not cost one.
	 */
	state(): PanelState {
		return {
			phase: this.phase,
			open: this.watching && this.phase !== "closed",
			url: this.url,
			title: this.title,
			connected: this.connected,
		};
	}

	/** The last frame, for a reader that does not have it yet. */
	latestFrame(): StreamFrame | undefined {
		return this.frame;
	}

	/** Stop for good: the plugin is going away. */
	stop(): void {
		this.watching = false;
		this.pending = [];
		this.announced = [];
		this.cancelIdle();
		this.cancelRetry();
		this.stopTyping();
		this.closePeer("the plugin was unloaded");
		this.connected = false;
		this.phase = "none";
		this.message = NOTHING_OPEN;
		this.error = undefined;
		this.paused = false;
		this.frame = undefined;
		this.page = { width: 0, height: 0 };
		this.activity = [];
	}

	/** Open the screencast, when there is a reason to and nobody else is. */
	private async open(): Promise<void> {
		if (
			this.opening ||
			this.peer !== undefined ||
			this.retryTimer !== undefined ||
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
				this.gave(NOT_RUNNING, "none");

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
			this.error = undefined;
			this.paused = false;
			this.phase = "live";
			this.message = "";
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
			this.gave(errorText(error), "unreachable");
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

				if (event.tabs.length > 0) this.tabs = [...event.tabs];

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
			const mine = this.takeAnnouncement(activity.action);

			if (mine !== undefined) {
				// The command was caused by the person at the panel, so the feed says
				// so; its duration is not their act and is dropped with the pair.
				this.remember({ kind: "human", text: mine, at: Date.now() });

				return;
			}

			if (this.commanding.size > COMMAND_WINDOW) this.commanding.clear();

			this.commanding.add(activity.id);
			this.remember(activity);

			return;
		}

		if (!this.commanding.delete(activity.id)) return;

		this.remember(activity);
	}

	/** The person's line waiting for one CLI action, if it is still fresh. */
	private takeAnnouncement(action: string): string | undefined {
		const now = Date.now();

		// Expired announcements go first, so the index below points at the entry
		// it was found on rather than at one the filter would have removed.
		this.announced = this.announced.filter((entry) => entry.until > now);

		const index = this.announced.findIndex((entry) => entry.action === action);

		if (index === -1) return undefined;

		const [mine] = this.announced.splice(index, 1);

		return mine?.text;
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

	/** One act of the person, as the feed line and the note the agent gets. */
	private rememberHuman(input: PanelInput): void {
		if (input.type === "key") {
			if (input.event !== "down") return;

			// A printable key is part of a word the person is typing: one line per
			// letter would push every action of the agent out of the window.
			if (input.key.length === 1) {
				this.typing += input.key;
				this.armTyping();

				return;
			}

			this.flushTyping();
		} else {
			this.flushTyping();
		}

		const line = humanLineOf(input);
		const note = noteOf(input);

		if (line !== undefined)
			this.remember({ kind: "human", text: line, at: Date.now() });
		if (note !== undefined) this.note(note);
	}

	/** Wait a moment for the word to finish before it becomes one line. */
	private armTyping(): void {
		if (this.typingTimer !== undefined) clearTimeout(this.typingTimer);

		this.typingTimer = setTimeout(() => {
			this.typingTimer = undefined;
			this.flushTyping();
		}, TYPING_SETTLE_MS);
		this.typingTimer.unref();
	}

	/** Turn whatever the person has typed so far into one line and one note. */
	private flushTyping(): void {
		this.stopTyping();

		const typed = this.typing;

		this.typing = "";

		if (typed === "") return;

		this.remember({ kind: "human", text: `type ${typed}`, at: Date.now() });
		this.note(`typed "${typed}"`);
	}

	private stopTyping(): void {
		if (this.typingTimer === undefined) return;

		clearTimeout(this.typingTimer);
		this.typingTimer = undefined;
	}

	/** The screencast ended on its own. */
	private lose(reason: string): void {
		if (this.closing) return;

		this.generation += 1;
		this.peer = undefined;
		this.connected = false;
		// The last picture and the feed are kept: the page did not go back, and
		// losing the socket is not a reason to make a person forget what happened.
		this.gave(`the live view lost its connection (${reason})`, "unreachable");
	}

	/** Nothing to watch, and why; retried a few times, then left to a tool call. */
	private gave(reason: string, phase: "none" | "unreachable"): void {
		this.connected = false;
		this.paused = false;
		this.phase = phase;

		if (phase === "unreachable") {
			this.error = `${reason}. Retry when the browser is ready; the person at the panel can also press Retry.`;
			this.message = "";
		} else {
			this.error = undefined;
			this.message = reason;
		}

		this.attempts += 1;

		if (this.attempts < MAX_ATTEMPTS) this.scheduleRetry();
	}

	/** One more attempt, further away than the last. */
	private scheduleRetry(): void {
		if (this.retryTimer !== undefined || !this.watching) return;

		const delay = Math.min(
			RETRY_BASE_MS * 2 ** (this.attempts - 1),
			RETRY_CAP_MS,
		);

		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			void this.open();
		}, delay);
		this.retryTimer.unref();
	}

	/** Stop watching a while after the last poll, keeping what was seen. */
	private armIdle(): void {
		this.cancelIdle();
		this.idle = setTimeout(() => {
			this.idle = undefined;

			if (!this.watching) return;

			this.pause();
		}, this.deps.idleMs ?? DEFAULT_IDLE_MS);
		this.idle.unref();
	}

	/**
	 * End the connection because nobody is watching, without forgetting the page.
	 *
	 * The feed and the last frame stay: a person who comes back to the panel asks
	 * what happened while they were away, and an empty list is the one answer
	 * that cannot help.
	 */
	private pause(): void {
		this.flushTyping();
		this.cancelRetry();
		this.closePeer("nobody is watching");
		this.connected = false;
		this.paused = true;
		this.phase = "paused";
		this.message = PAUSED;
		this.error = undefined;
		this.page = { width: 0, height: 0 };
	}

	/** Close the socket we hold, if we hold one. */
	private closePeer(reason: string): void {
		const peer = this.peer;

		this.generation += 1;
		this.peer = undefined;
		this.closing = true;

		try {
			peer?.close(reason);
		} finally {
			this.closing = false;
		}
	}

	private cancelIdle(): void {
		if (this.idle === undefined) return;

		clearTimeout(this.idle);
		this.idle = undefined;
	}

	private cancelRetry(): void {
		if (this.retry === undefined) return;

		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
	}
}

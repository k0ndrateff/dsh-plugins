/**
 * One hub per session, made when something first asks for it.
 *
 * This is where the tools and the panel meet: a tool call says "this session has
 * a browser" through `markLive`, and a panel that connects for that session finds
 * the hub already watching. A session nobody has driven gets a hub that watches
 * nothing — which is the point of the registry, because asking the CLI about a
 * fabricated session name would start a daemon for it.
 */

import type { PanelState } from "../../shared/panel";
import type { StreamHub } from "./hub";

export class StreamHubs {
	private readonly hubs = new Map<string, StreamHub>();

	/** A page request may name any well-formed session; keep the map bounded. */
	private readonly limit = 64;

	/** @param build - how one session's hub is put together. */
	constructor(private readonly build: (session: string) => StreamHub) {}

	/** The hub for one session, made on first use. */
	for(session: string): StreamHub {
		const existing = this.hubs.get(session);

		if (existing !== undefined) return existing;

		if (this.hubs.size >= this.limit) {
			const stale = [...this.hubs.entries()].find(([, hub]) => !hub.watched);

			if (stale !== undefined) {
				stale[1].stop();
				this.hubs.delete(stale[0]);
			}
		}

		const hub = this.build(session);

		this.hubs.set(session, hub);

		return hub;
	}

	/** A tool call proved this session has a browser. */
	markLive(session: string): void {
		this.for(session).markLive();
	}

	/** This session's browser was closed on purpose. */
	markClosed(session: string): void {
		this.hubs.get(session)?.markClosed();
	}

	/**
	 * Whether this conversation has a browser, without making a hub for it.
	 * @param session - the conversation's browser session.
	 */
	state(session: string): PanelState {
		return (
			this.hubs.get(session)?.state() ?? { open: false, url: "", title: "" }
		);
	}

	/**
	 * What the person did in one session since the last tool call.
	 * @param session - the session whose browser was being used.
	 * @returns the sentence, or undefined when nobody touched the page.
	 */
	takeNote(session: string): string | undefined {
		return this.hubs.get(session)?.takeNote();
	}

	/** Remember one act of a person for the agent to be told about. */
	note(session: string, note: string | undefined): void {
		if (note !== undefined) this.hubs.get(session)?.note(note);
	}

	/** The sessions whose browser a tool has actually reached. */
	liveSessions(): readonly string[] {
		return [...this.hubs.entries()]
			.filter(([, hub]) => hub.watched)
			.map(([session]) => session);
	}

	/** Stop every hub; the plugin is going away. */
	stop(): void {
		for (const hub of this.hubs.values()) hub.stop();

		this.hubs.clear();
	}
}

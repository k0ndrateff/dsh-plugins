/**
 * One hub per session, made when something first asks for it.
 *
 * This is where the tools and the panel meet: a tool call says "this session has
 * a browser" through `markLive`, and a panel that connects for that session finds
 * the hub already watching. A session nobody has driven gets a hub that watches
 * nothing — which is the point of the registry, because asking the CLI about a
 * fabricated session name would start a daemon for it.
 */

import type { StreamHub } from "./hub";

export class StreamHubs {
	private readonly hubs = new Map<string, StreamHub>();

	/** @param build - how one session's hub is put together. */
	constructor(private readonly build: (session: string) => StreamHub) {}

	/** The hub for one session, made on first use. */
	for(session: string): StreamHub {
		const existing = this.hubs.get(session);

		if (existing !== undefined) return existing;

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

	/** Stop every hub; the plugin is going away. */
	stop(): void {
		for (const hub of this.hubs.values()) hub.stop();

		this.hubs.clear();
	}
}

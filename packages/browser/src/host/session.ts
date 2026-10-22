/**
 * Which browser belongs to which harness session.
 *
 * One browser per session: two agents working at once must not fight over one
 * page, and a page left open by an earlier conversation must not become this
 * one's starting point. The name is derived from the harness session id, so the
 * same conversation always lands on the same browser — and a `bash` call that
 * names that session reaches the same daemon.
 *
 * The shared `default` session is deliberately not used: it belongs to every
 * other agent-browser caller on the machine.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";

/** What every session's browser is named with, so its daemon is ours. */
export const SESSION_PREFIX = "dsh-";

/** The longest session name this plugin builds, in characters. */
export const MAX_SESSION_NAME = 40;

/** The name used when a call arrives without a session behind it. */
const NO_SESSION = "nosession";

/**
 * Everything a session name may contain, so it is safe in a socket path.
 *
 * Case is kept: two session ids that differ only in case are two sessions, and
 * folding them together would hand one conversation another's page.
 */
const sanitize = (value: string): string =>
	value
		.replace(/[^A-Za-z0-9._-]+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^[-.]+|[-.]+$/gu, "");

/**
 * The browser one harness session owns.
 * @param sessionId - the calling session's id, when there is one.
 */
export const sessionNameOf = (sessionId: string | undefined): string => {
	const cleaned = sanitize(sessionId ?? "");
	const room = MAX_SESSION_NAME - SESSION_PREFIX.length;

	return `${SESSION_PREFIX}${(cleaned === "" ? NO_SESSION : cleaned).slice(0, room)}`;
};

/** One browser, and the directory its commands run in. */
export interface BrowserSession {
	/** The agent-browser session this conversation owns. */
	readonly name: string;
	/** The calling session's working directory. */
	readonly cwd: string;
}

/** Resolving the browser and the directory one call belongs to. */
export class SessionScope {
	/** @param ctx - host context carrying the session working directory. */
	constructor(private readonly ctx: Context) {}

	/**
	 * The browser this call belongs to.
	 * @param agent - the calling session's agent, when the caller has one.
	 * @param signal - the caller's cancellation.
	 */
	async of(
		agent: Agent | undefined,
		signal: AbortSignal,
	): Promise<BrowserSession> {
		const cwd =
			agent === undefined
				? process.cwd()
				: await this.ctx.workingDirectory.ensure(agent, signal);

		return { name: sessionNameOf(agent?.session.id), cwd };
	}
}

/**
 * The host's view of which browser belongs to which harness session.
 *
 * The naming rule itself lives in `src/shared/session.ts`, because the panel
 * derives the same name from the same session id: the two halves have no shared
 * runtime, but they must agree about which browser they are talking about.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { sessionNameOf } from "../shared/session";

export {
	isSessionName,
	MAX_SESSION_NAME,
	SESSION_PREFIX,
	sessionNameOf,
} from "../shared/session";

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

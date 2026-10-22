/**
 * What every browser tool shares.
 *
 * One tool, one question; the runner, the session, the caps and the hubs are the
 * same for all of them, so they are handed over once. The helper below is the
 * only way a tool reaches the browser, which is what makes it the right place
 * for the other half of the rule: a call that worked is what tells the panel's
 * hubs that this session has a browser worth watching.
 */

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { BrowserSettings } from "../config";
import type { AgentBrowserRunner, BrowserOutcome } from "../runner";
import type { BrowserSession, SessionScope } from "../session";
import type { StreamHubs } from "../stream/hubs";

/** The collaborators every browser tool is built with. */
export interface BrowserToolDeps {
	readonly runner: AgentBrowserRunner;
	readonly sessions: SessionScope;
	readonly config: BrowserSettings;
	readonly hubs: StreamHubs;
}

/** One tool of this plugin, as the composition root registers it. */
export interface BrowserTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME: string;
	/** Build the definition for one plugin instance. */
	create(deps: BrowserToolDeps): ToolDefinition;
}

/** One call's browser, and what came back from it. */
export interface BrowserCall {
	readonly session: BrowserSession;
	readonly outcome: BrowserOutcome;
}

/**
 * Run one command in the calling session's own browser.
 * @param deps - the shared collaborators.
 * @param exec - the calling execution, for its agent and its cancellation.
 * @param args - the agent-browser command and its arguments.
 */
export const runForSession = async (
	deps: BrowserToolDeps,
	exec: ToolRunContext,
	args: readonly string[],
): Promise<BrowserCall> => {
	const session = await deps.sessions.of(exec.agent, exec.signal);
	const outcome = await deps.runner.run({
		args,
		session: session.name,
		cwd: session.cwd,
		signal: exec.signal,
	});

	// A command that ran is proof of a browser in this session, and that is the
	// only thing that ever lets a panel start watching one.
	if (outcome.ok) deps.hubs.markLive(session.name);

	return { session, outcome };
};

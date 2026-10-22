/**
 * What every browser tool shares.
 *
 * One tool, one question; the runner, the session and the caps are the same for
 * all of them, so they are handed over once. The helper below is the only way a
 * tool reaches the browser: every call resolves the calling session first, so no
 * tool can accidentally drive the shared default session.
 */

import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { BrowserConfig } from "../config";
import type { AgentBrowserRunner, BrowserOutcome } from "../runner";
import type { SessionScope } from "../session";

/** The collaborators every browser tool is built with. */
export interface BrowserToolDeps {
	readonly runner: AgentBrowserRunner;
	readonly sessions: SessionScope;
	readonly config: BrowserConfig;
}

/** One tool of this plugin, as the composition root registers it. */
export interface BrowserTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME: string;
	/** Build the definition for one plugin instance. */
	create(deps: BrowserToolDeps): ToolDefinition;
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
): Promise<BrowserOutcome> => {
	const session = await deps.sessions.of(exec.agent, exec.signal);

	return await deps.runner.run({
		args,
		session: session.name,
		cwd: session.cwd,
		signal: exec.signal,
	});
};

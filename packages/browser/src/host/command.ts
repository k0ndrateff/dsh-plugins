/**
 * The `/browser` slash command.
 *
 * A command runs against the agent without a model message, which makes it the
 * human's side of the same browser the tools drive: `/browser status` says
 * whether the CLI and Chrome are usable here, and `/browser close` shuts this
 * conversation's browser down — the thing a person wants after watching a
 * headless browser they did not start themselves.
 *
 * Neither action touches another session's browser, and closing is the only
 * thing either of them writes anywhere.
 */

import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { BrowserConfig } from "./config";
import type { AgentBrowserRunner } from "./runner";
import type { BrowserSession, SessionScope } from "./session";
import type { StreamHubs } from "./stream/hubs";
import { errorText } from "./text";

/** What the command accepts after its name. */
const ACTIONS = ["status", "close"] as const;

type Action = (typeof ACTIONS)[number];

/** What the command needs from the plugin. */
export interface BrowserCommandDeps {
	readonly runner: AgentBrowserRunner;
	readonly sessions: SessionScope;
	readonly config: BrowserConfig;
	readonly hubs: StreamHubs;
}

class BrowserCommand {
	/** The command's name, without the leading slash. */
	readonly COMMAND_NAME = "browser";

	/**
	 * Build the command handler.
	 * @param deps - the runner, the session scope, and the configured executable.
	 */
	create = (
		deps: BrowserCommandDeps,
	): ((invocation: CommandInvocation) => Promise<CommandResult>) => {
		return async (invocation) => {
			const action = this.parseAction(invocation.rawInput);

			if (action === undefined)
				return {
					kind: "success",
					text: `Browser: ${ACTIONS.join(" | ")}.`,
				};

			const session = await deps.sessions.of(
				invocation.agent,
				invocation.signal,
			);

			try {
				return action === "close"
					? await this.close(deps, session, invocation.signal)
					: await this.status(deps, session, invocation.signal);
			} catch (error) {
				return { kind: "error", text: `browser: ${errorText(error)}` };
			}
		};
	};

	/** The action the human typed, or undefined for none. */
	private parseAction(rawInput: string): Action | undefined {
		const wanted = rawInput.trim().toLowerCase();

		return ACTIONS.find((action) => action === wanted);
	}

	/** Whether this machine can run the browser, and why not when it cannot. */
	private async status(
		deps: BrowserCommandDeps,
		session: BrowserSession,
		signal: AbortSignal,
	): Promise<CommandResult> {
		const report = await deps.runner.status({
			session: session.name,
			cwd: session.cwd,
			signal,
		});

		if (report === undefined)
			return {
				kind: "error",
				text:
					`The browser needs the agent-browser CLI, and "${deps.config.executable}" is not on PATH.\n` +
					"Install it with: npm install -g agent-browser && agent-browser install",
			};

		return {
			kind: "success",
			text: [
				`Browser session: ${session.name}`,
				...(report.version === undefined
					? []
					: [`agent-browser ${report.version}`]),
				...(report.chrome === undefined ? [] : [`Chrome: ${report.chrome}`]),
				"",
				...(report.failing.length === 0
					? ["Every check passed."]
					: ["Failing checks:", ...report.failing.map((line) => `  ${line}`)]),
			].join("\n"),
		};
	}

	/** Close this conversation's browser, and nothing else. */
	private async close(
		deps: BrowserCommandDeps,
		session: BrowserSession,
		signal: AbortSignal,
	): Promise<CommandResult> {
		const outcome = await deps.runner.run({
			args: ["close"],
			session: session.name,
			cwd: session.cwd,
			signal,
		});

		// A closed browser is one the panel should stop looking for, whether or not
		// the close itself succeeded: there is nothing to watch either way.
		deps.hubs.markClosed(session.name);

		return outcome.ok
			? { kind: "success", text: `Closed the browser of ${session.name}.` }
			: { kind: "error", text: `browser close: ${outcome.error}` };
	}
}

export const browserCommand = new BrowserCommand();

/**
 * The `/browser` slash command.
 *
 * A command runs against the agent without a model message, which makes it the
 * human's side of the same browser the tools drive: `/browser status` says what
 * this conversation's browser is doing and whether the machine can run one at
 * all, and `/browser close` shuts this conversation's browser down — the thing a
 * person wants after watching a headless browser they did not start themselves.
 *
 * Neither action touches another session's browser, and closing is the only
 * thing either of them writes anywhere. Both answer in a person's words: the
 * check ids `doctor` reports are turned into names, and an unknown action is an
 * error with the list of what the command takes instead of a silent help page.
 */

import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import type { PanelPhase, PanelState } from "../shared/panel";
import type { BrowserSettings } from "./config";
import type { AgentBrowserRunner } from "./runner";
import type { BrowserSession, SessionScope } from "./session";
import { failingChecks } from "./status";
import type { StreamHubs } from "./stream/hubs";
import { errorText } from "./text";

/** What the command accepts after its name. */
const ACTIONS = ["status", "close"] as const;

/** The line that names every action, for an empty or unknown one. */
const USAGE = "Browser: status | close.";

/** What the command needs from the plugin. */
export interface BrowserCommandDeps {
	readonly runner: AgentBrowserRunner;
	readonly sessions: SessionScope;
	readonly config: BrowserSettings;
	readonly hubs: StreamHubs;
}

/** How one phase of the live view reads in the status answer. */
const PHASE_WORDS: Readonly<Record<PanelPhase, string>> = {
	none: "not opened yet",
	starting: "connecting",
	live: "open",
	closed: "closed",
	paused: "open, live view paused",
	unreachable: "open, live view unreachable",
};

/** This conversation's own browser, as one line. */
const browserLine = (state: PanelState): string => {
	const words = PHASE_WORDS[state.phase];

	if (state.url === "") return `This conversation's browser: ${words}.`;

	const title = state.title === "" ? "" : ` — “${state.title}”`;

	return `This conversation's browser: ${words} at ${state.url}${title}`;
};

/** What one check's status looks like without a legend. */
const MARK: Readonly<Record<string, string>> = {
	pass: "✓",
	fail: "✗",
	warn: "!",
};

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
			const raw = invocation.rawInput.trim().toLowerCase();
			const action = ACTIONS.find((one) => one === raw);

			if (raw === "" || raw === "help") return { kind: "success", text: USAGE };

			if (action === undefined)
				return {
					kind: "error",
					text: `browser: unknown action "${raw}". ${USAGE}`,
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

	/** What this conversation has, and whether the machine can run it. */
	private async status(
		deps: BrowserCommandDeps,
		session: BrowserSession,
		signal: AbortSignal,
	): Promise<CommandResult> {
		const state = deps.hubs.state(session.name);
		const report = await deps.runner.status({
			session: session.name,
			cwd: session.cwd,
			signal,
		});

		if (report === undefined)
			return {
				kind: "error",
				text:
					browserLine(state) +
					`\nThe browser needs the agent-browser CLI, and "${deps.config.executable}" is not on PATH.\n` +
					"Install it with: npm install -g agent-browser && agent-browser install",
			};

		const failed = failingChecks(report);

		return {
			kind: "success",
			text: [
				browserLine(state),
				"",
				...(report.version === undefined
					? []
					: [`agent-browser ${report.version}`]),
				...(report.chrome === undefined ? [] : [`Chrome: ${report.chrome}`]),
				"Checks:",
				...report.checks.map(
					(check) =>
						`  ${MARK[check.status] ?? "·"} ${check.label}: ${check.message}`,
				),
				"",
				failed.length === 0
					? "Every check passed."
					: `${failed.length} check${failed.length === 1 ? "" : "s"} failed. Fix ${failed.length === 1 ? "it" : "them"} before the browser can run.`,
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

		// Only a close that happened stops the panel from looking: a failed close
		// leaves a live browser, and the panel must stay able to reconnect.
		if (outcome.ok) {
			// The agent drives the browser between its own tool calls, so a person
			// closing it must be the first thing its next result says.
			deps.hubs.for(session.name).note("closed the browser");
			deps.hubs.markClosed(session.name);

			return {
				kind: "success",
				text: "Closed this conversation's browser.",
			};
		}

		return { kind: "error", text: `browser close: ${outcome.error}` };
	}
}

export const browserCommand = new BrowserCommand();

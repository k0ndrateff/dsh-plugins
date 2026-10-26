/**
 * `browser_close` — end the browser a conversation no longer needs.
 *
 * A browser is a real Chrome process with its own memory, profile and socket.
 * The plugin closes it when the plugin unloads, but a conversation that is done
 * checking a page should not have to wait for that: without a way to close it,
 * the only way the model could end the work was the escape hatch, and the
 * description of five other tools never said so.
 *
 * Closing is reported as done even when there was nothing to close: "there was
 * no browser" is the state the caller asked for, and a failure would send the
 * model looking for a problem that is not there.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_CLOSE_TOOL } from "../../shared/tools";
import type { BrowserToolDeps } from "./deps";
import { failureOf } from "./failure";

class CloseTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_CLOSE_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the hubs.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Close this conversation's browser and free the Chrome process behind it. Call it " +
			"when you are done checking the page: the next browser_open starts a fresh browser " +
			"with the same profile, so nothing on disk is lost, but cookies set through the page " +
			"in this session are gone. It is safe to call when no browser is open.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					closed: { type: "boolean" },
					message: { type: "string" },
				},
				required: ["closed", "message"],
			},
			render: (_args, value) => {
				const answer = value as { closed: boolean; message: string };

				return [{ type: "text", text: answer.message }];
			},
		},
		execute: async (_rawArgs, exec) => {
			const session = await deps.sessions.of(exec.agent, exec.signal);
			const outcome = await deps.runner.run({
				args: ["close"],
				session: session.name,
				cwd: session.cwd,
				signal: exec.signal,
			});

			if (!outcome.ok) {
				if (
					/no browser|not (launched|running)|browser was closed/i.test(
						outcome.error,
					)
				)
					return {
						closed: false,
						message: "This conversation had no open browser to close.",
					};

				throw failureOf(outcome);
			}

			deps.hubs.markClosed(session.name);

			return {
				closed: true,
				message: "Closed this conversation's browser.",
			};
		},
	});
}

export const closeTool = new CloseTool();

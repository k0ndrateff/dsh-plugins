/**
 * The `/figma` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action. The four actions
 * are the ones every integration answers — status, login, logout, sync — but the
 * shared handler belongs to an integration that signs in, and this one does not:
 * what `/figma login` can honestly say is which switch to turn on, and what
 * `/figma logout` does is drop a connection that will come back by itself.
 */

import type { CommandResult, IntegrationAuthFace } from "dsh-integration-host";
import { errorText } from "dsh-mcp-oauth";
import type { FigmaStatus } from "../../shared/status";

/** The command's name, without the leading slash. */
export const COMMAND_NAME = "figma";

/** What the command accepts after its name. */
const ACTIONS = ["status", "login", "logout", "sync"] as const;

type Action = (typeof ACTIONS)[number];

/**
 * Which action a raw input names.
 * @returns the action, `undefined` for a word that is not one, and the status
 *   for an input that names nothing.
 */
const parseAction = (rawInput: unknown): Action | undefined => {
	const first =
		String(rawInput ?? "")
			.trim()
			.split(/\s+/u)[0] ?? "";

	if (first === "") return "status";

	return (ACTIONS as readonly string[]).includes(first)
		? (first as Action)
		: undefined;
};

/**
 * Build the handler the command registers.
 * @param auth - the one implementation of connection state.
 */
export const createCommandHandler = (
	auth: IntegrationAuthFace<FigmaStatus>,
): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
	return async ({ rawInput }) => {
		const action = parseAction(rawInput);

		if (action === undefined)
			return {
				kind: "error",
				text: `"${
					String(rawInput ?? "")
						.trim()
						.split(/\s+/u)[0] ?? ""
				}" is not a /figma action; use ${ACTIONS.join(", ")}.`,
			};

		try {
			if (action === "login")
				return {
					kind: "success",
					text: auth.loginMessage(await auth.getStatus()),
				};

			if (action === "logout") {
				await auth.signOut();

				return {
					kind: "success",
					text: "Disconnected from the Figma Dev Mode MCP server.",
				};
			}

			if (action === "sync") {
				const ok = await auth.connect();
				const status = await auth.getStatus();

				return ok
					? {
							kind: "success",
							text: `Figma tools ready (${status.tools.length}).`,
						}
					: {
							kind: "error",
							text:
								status.error ?? "The Figma Dev Mode MCP server did not answer.",
						};
			}

			const status = await auth.getStatus();

			if (!status.connected)
				return {
					kind: "success",
					text:
						status.error ??
						`Not connected to the Figma Dev Mode MCP server at ${status.endpoint}. Run /figma sync.`,
				};

			return {
				kind: "success",
				text: `Connected to the Figma Dev Mode MCP server at ${status.endpoint}. ${status.tools.length} tools loaded.`,
			};
		} catch (error) {
			return { kind: "error", text: `Figma: ${errorText(error)}` };
		}
	};
};

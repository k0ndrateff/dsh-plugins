/**
 * The `/atlassian` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * It shares its implementation with the settings card, so the two can never
 * disagree about what "signed in" means.
 */

import { errorText } from "dsh-mcp-oauth";
import type { AtlassianAuth } from "../auth";

/** What the command accepts after its name. */
const ACTIONS = ["status", "login", "logout", "sync"] as const;
type Action = (typeof ACTIONS)[number];

/** The command result vocabulary the command seam renders. */
interface CommandResult {
	readonly kind: "success" | "error";
	readonly text: string;
}

class CommandHandler {
	/** The command's name, without the leading slash. */
	readonly COMMAND_NAME = "atlassian";

	/**
	 * Build the command handler.
	 * @param auth - the one implementation of sign-in state.
	 */
	create = (
		auth: AtlassianAuth,
	): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
		return async ({ rawInput }) => {
			const action = this.parseAction(rawInput);

			try {
				if (action === "login") {
					void auth.signIn();
					await auth.settleNotice();

					return {
						kind: "success",
						text: auth.loginMessage(await auth.getStatus()),
					};
				}

				if (action === "logout") {
					await auth.signOut();

					return { kind: "success", text: "Signed out of Atlassian." };
				}

				if (action === "sync") {
					const ok = await auth.connect();
					const status = await auth.getStatus();

					return ok
						? {
								kind: "success",
								text: `Atlassian tools ready (${status.tools.length}).`,
							}
						: {
								kind: "error",
								text:
									status.error ??
									"Not signed in to Atlassian. Run /atlassian login.",
							};
				}

				const status = await auth.getStatus();

				if (!status.signedIn) {
					return {
						kind: "success",
						text: "Not signed in to Atlassian. Run /atlassian login.",
					};
				}

				const until =
					status.expiresAt === null
						? "unknown"
						: new Date(status.expiresAt).toLocaleString();

				return {
					kind: "success",
					text: `Signed in to Atlassian. Token valid until ${until}. ${status.tools.length} tools loaded.`,
				};
			} catch (error) {
				return { kind: "error", text: `Atlassian: ${errorText(error)}` };
			}
		};
	};

	private parseAction = (rawInput: unknown): Action => {
		const first =
			String(rawInput ?? "")
				.trim()
				.split(/\s+/u)[0] ?? "";

		return (ACTIONS as readonly string[]).includes(first)
			? (first as Action)
			: "status";
	};
}

export const commandHandler = new CommandHandler();

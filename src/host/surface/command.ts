/**
 * The `/atlassian` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * It shares its implementation with the settings card, so the two can never
 * disagree about what "signed in" means.
 */

import type { Context } from "@deepseek-ai/cordis";
import { auth } from "../auth";
import type { Config } from "../config";
import { errorText } from "../log";
import { mcpBridge } from "../mcp/bridge";
import type { RuntimeState } from "../state";

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
	 * @param ctx - host context.
	 * @param state - shared runtime state.
	 * @param config - resolved configuration.
	 */
	create = (
		ctx: Context,
		state: RuntimeState,
		config: Config,
	): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
		return async ({ rawInput }) => {
			const action = this.parseAction(rawInput);

			try {
				if (action === "login") {
					void auth.signIn(ctx, state, config);
					await auth.settleNotice();

					return {
						kind: "success",
						text: auth.loginMessage(await auth.getStatus(ctx, state, config)),
					};
				}

				if (action === "logout") {
					await auth.signOut(ctx, state);

					return { kind: "success", text: "Signed out of Atlassian." };
				}

				if (action === "sync") {
					const ok = await mcpBridge.ensure(ctx, state, config);
					const status = await auth.getStatus(ctx, state, config);

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

				const status = await auth.getStatus(ctx, state, config);

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

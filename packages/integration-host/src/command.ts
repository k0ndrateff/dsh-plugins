/**
 * The slash command every integration offers.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * It shares its implementation with the settings card, so the two can never
 * disagree about what "signed in" means.
 */

import { errorText } from "dsh-mcp-oauth";
import type { IntegrationAuthFace } from "./auth";
import type { IntegrationStatus } from "./status";

/** What the command accepts after its name. */
const ACTIONS = ["status", "login", "logout", "sync"] as const;

type Action = (typeof ACTIONS)[number];

/** The command result vocabulary the command seam renders. */
export interface CommandResult {
	readonly kind: "success" | "error";
	readonly text: string;
}

/** What one provider says about itself in the command's answers. */
export interface CommandSpec<TStatus extends IntegrationStatus> {
	/** The command's name, without the leading slash. */
	readonly name: string;
	/** The provider's name, as the user sees it. */
	readonly label: string;
	/**
	 * One sentence the status answer adds after the token's expiry, such as the
	 * account it works with.
	 * @returns the sentence with its own full stop, or an empty string.
	 */
	readonly describe?: (status: TStatus) => string;
}

/**
 * Build the handler one integration's command registers.
 * @param spec - the command's name, its provider's label, and what that provider adds.
 * @param auth - the one implementation of sign-in state.
 * @returns a handler the command seam can call.
 */
export const createIntegrationCommand = <TStatus extends IntegrationStatus>(
	spec: CommandSpec<TStatus>,
	auth: IntegrationAuthFace<TStatus>,
): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
	const parseAction = (rawInput: unknown): Action => {
		const first =
			String(rawInput ?? "")
				.trim()
				.split(/\s+/u)[0] ?? "";

		return (ACTIONS as readonly string[]).includes(first)
			? (first as Action)
			: "status";
	};

	return async ({ rawInput }) => {
		const action = parseAction(rawInput);

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

				return { kind: "success", text: `Signed out of ${spec.label}.` };
			}

			if (action === "sync") {
				const ok = await auth.connect();
				const status = await auth.getStatus();

				return ok
					? {
							kind: "success",
							text: `${spec.label} tools ready (${status.tools.length}).`,
						}
					: {
							kind: "error",
							text:
								status.error ??
								`Not signed in to ${spec.label}. Run /${spec.name} login.`,
						};
			}

			const status = await auth.getStatus();

			if (!status.signedIn)
				return {
					kind: "success",
					text: `Not signed in to ${spec.label}. Run /${spec.name} login.`,
				};

			const until =
				status.expiresAt === null
					? "unknown"
					: new Date(status.expiresAt).toLocaleString();
			const extra = spec.describe?.(status) ?? "";
			const tail = extra === "" ? "" : ` ${extra}`;

			return {
				kind: "success",
				text: `Signed in to ${spec.label}. Token valid until ${until}.${tail} ${status.tools.length} tools loaded.`,
			};
		} catch (error) {
			return { kind: "error", text: `${spec.label}: ${errorText(error)}` };
		}
	};
};

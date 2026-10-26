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

/** One instant as a person reads it, with the zone that makes it unambiguous. */
const expiryText = (time: number): string =>
	new Date(time).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});

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

	return async ({ rawInput }) => {
		const action = parseAction(rawInput);

		if (action === undefined) {
			const first =
				String(rawInput ?? "")
					.trim()
					.split(/\s+/u)[0] ?? "";

			return {
				kind: "error",
				text: `Unknown action "${first}". Use /${spec.name} ${ACTIONS.join("|")}.`,
			};
		}

		try {
			if (action === "login") {
				void auth.signIn();
				await auth.settleNotice();

				const status = await auth.getStatus();

				if (status.error !== null) return { kind: "error", text: status.error };

				const text = auth.loginMessage(status);

				return {
					kind: "success",
					text: status.inFlight
						? `${text}\nRun /${spec.name} status when you have approved it.`
						: text,
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

			if (status.error !== null) return { kind: "error", text: status.error };

			if (!status.signedIn)
				return {
					kind: "success",
					text: `Not connected to ${spec.label}. Run /${spec.name} login to connect.`,
				};

			if (!status.connected)
				return {
					kind: "success",
					text: `${spec.label} is connected with a stored credential but not answering. Run /${spec.name} sync.`,
				};

			const until =
				status.expiresAt === null
					? ""
					: ` Token valid until ${expiryText(status.expiresAt)}.`;
			const extra = spec.describe?.(status) ?? "";
			const tail = extra === "" ? "" : ` ${extra}`;

			return {
				kind: "success",
				text: `Connected to ${spec.label}.${until}${tail} ${status.tools.length} tools loaded.`,
			};
		} catch (error) {
			return { kind: "error", text: `${spec.label}: ${errorText(error)}` };
		}
	};
};

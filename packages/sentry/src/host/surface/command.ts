/**
 * The `/sentry` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * The command itself belongs to `dsh-integration-host`, which shares it with the
 * settings card so the two can never disagree about what "signed in" means; what
 * Sentry adds is the organization its status line names.
 */

import {
	type CommandResult,
	createIntegrationCommand,
	type IntegrationAuthFace,
} from "dsh-integration-host";
import type { SentryStatus } from "../../shared/status";

/** The command's name, without the leading slash. */
export const COMMAND_NAME = "sentry";

/** One sentence about the account this installation works with. */
const describe = (status: SentryStatus): string =>
	status.organization === null ? "" : `Organization: ${status.organization}.`;

/**
 * Build the handler the command registers.
 * @param auth - the one implementation of sign-in state.
 */
export const createCommandHandler = (
	auth: IntegrationAuthFace<SentryStatus>,
): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
	return createIntegrationCommand<SentryStatus>(
		{ name: COMMAND_NAME, label: "Sentry", describe },
		auth,
	);
};

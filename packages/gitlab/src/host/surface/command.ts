/**
 * The `/gitlab` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * The command itself belongs to `dsh-integration-host`, which shares it with the
 * settings card so the two can never disagree about what "signed in" means; what
 * GitLab adds is the account its status line names.
 */

import {
	type CommandResult,
	createIntegrationCommand,
	type IntegrationAuthFace,
} from "dsh-integration-host";
import type { GitLabStatus } from "../../shared/status";

/** The command's name, without the leading slash. */
export const COMMAND_NAME = "gitlab";

/** One sentence about the account this installation works with. */
const describe = (status: GitLabStatus): string =>
	status.username === null ? "" : `Account: ${status.username}.`;

/**
 * Build the handler the command registers.
 * @param auth - the one implementation of sign-in state.
 */
export const createCommandHandler = (
	auth: IntegrationAuthFace<GitLabStatus>,
): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
	return createIntegrationCommand<GitLabStatus>(
		{ name: COMMAND_NAME, label: "GitLab", describe },
		auth,
	);
};

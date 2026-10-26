/**
 * The `/atlassian` slash command.
 *
 * A command runs directly against the agent without creating a model message,
 * which makes it the right surface for a human-driven action like signing in.
 * The command itself belongs to `dsh-integration-host`, which shares it with the
 * settings card so the two can never disagree about what "signed in" means.
 */

import {
	type CommandResult,
	createIntegrationCommand,
	type IntegrationAuthFace,
} from "dsh-integration-host";
import type { AtlassianStatus } from "../../shared/status";

/** The command's name, without the leading slash. */
export const COMMAND_NAME = "atlassian";

/** One sentence about the site this installation works with. */
const describe = (status: AtlassianStatus): string =>
	status.siteUrl === null ? "" : `Site: ${status.siteUrl}.`;

/**
 * Build the handler the command registers.
 * @param auth - the one implementation of sign-in state.
 */
export const createCommandHandler = (
	auth: IntegrationAuthFace<AtlassianStatus>,
): ((invocation: { rawInput?: unknown }) => Promise<CommandResult>) => {
	return createIntegrationCommand<AtlassianStatus>(
		{ name: COMMAND_NAME, label: "Atlassian", describe },
		auth,
	);
};

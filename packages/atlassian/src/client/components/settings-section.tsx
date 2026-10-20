/**
 * The Atlassian settings section.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 * The card itself belongs to `dsh-integration-ui`; what is Atlassian's is its
 * copy.
 */

import { createSettingsSection } from "dsh-integration-ui";
import type { AtlassianStatus } from "../../shared/status";
import { hostApi } from "../host-api";

/** The Atlassian settings card. */
export const AtlassianSection = createSettingsSection<AtlassianStatus>({
	title: "Atlassian",
	blurb: "Jira and Confluence, through Atlassian’s MCP server.",
	checking: "Checking the Atlassian sign-in…",
	unreachable: "The Atlassian host half is not reachable.",
	credentials: "browser",
	signInLabel: "Sign in with Atlassian",
	syncLabel: "Reconnect",
	api: hostApi,
});

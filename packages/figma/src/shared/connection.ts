/**
 * The one sentence the plugin owes a person when the Dev Mode server is absent.
 *
 * Figma is reached through a local MCP server that lives inside the desktop app,
 * so "the connection is not open" is not a transport failure to report — it is
 * the ordinary first-run state, and the only useful answer is what to start.
 * The settings card, the panel and the tool all say the same thing from here.
 */

/** What the user has to start before Figma has anything to say. */
export const DEV_MODE_HELP =
	"Start the Figma desktop app and turn on “Enable Dev Mode MCP Server” in its preferences, then run /figma sync (or press “Check again” in the Figma settings card).";

/** The Dev Mode server not answering, said so the person knows the next step. */
export const CONNECTION_FAILURE = `Figma's Dev Mode MCP server is not answering. ${DEV_MODE_HELP}`;

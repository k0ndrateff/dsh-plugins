/**
 * Atlassian configuration, and the provider profile built from it.
 *
 * The scope lists live here because they are Atlassian's, not the library's:
 * the two server generations use different vocabularies, and the library
 * narrows whichever list it is given to what the server actually advertises.
 */

import { DEFAULT_INSTANCE, type OAuthProviderProfile } from "dsh-mcp-oauth";

/** Atlassian's v1 MCP resource; the default because it needs no extra setup. */
export const DEFAULT_ENDPOINT = "https://mcp.atlassian.com/v1/mcp";

/** First loopback port tried for the OAuth redirect. */
export const DEFAULT_REDIRECT_PORT = 8143;

/** The name this plugin is registered under; it owns the credential record. */
export const PLUGIN_NAME = "dsh-atlassian";

/** Scopes wanted across both generations; whatever is not advertised is dropped. */
const DESIRED_SCOPES = [
	"offline_access",
	"read:jira-work",
	"write:jira-work",
	"read:jira-user",
	"read:page:confluence",
	"write:page:confluence",
	"search:confluence",
	"read:space:confluence",
	"read:jira:agent-interface",
	"write:jira:agent-interface",
	"search:jira:agent-interface",
	"read:confluence:agent-interface",
	"write:confluence:agent-interface",
	"search:confluence:agent-interface",
];

/** What a v1 authorization server understands when it advertises no scopes. */
const FALLBACK_SCOPES = [
	"offline_access",
	"read:jira-work",
	"write:jira-work",
	"read:jira-user",
	"read:page:confluence",
	"write:page:confluence",
	"search:confluence",
	"read:space:confluence",
];

/** Raw shape accepted from the profile patch. */
export interface ConfigInput {
	readonly endpoint?: unknown;
	readonly redirectPort?: unknown;
	readonly debug?: unknown;
}

/** Resolved configuration: every field present and of the right type. */
export interface Config {
	readonly endpoint: string;
	readonly redirectPort: number;
	readonly debug: boolean;
}

/**
 * Normalize whatever the loader passed. Unknown or malformed fields fall back
 * to the defaults rather than failing activation, because a typo in a profile
 * patch should not take the plugin down.
 */
export function resolveConfig(input: ConfigInput | undefined): Config {
	const endpoint =
		typeof input?.endpoint === "string" && input.endpoint !== ""
			? input.endpoint
			: DEFAULT_ENDPOINT;

	const port = Number(input?.redirectPort);

	return {
		endpoint,
		redirectPort:
			Number.isInteger(port) && port > 0 && port < 65_536
				? port
				: DEFAULT_REDIRECT_PORT,
		debug: input?.debug === true,
	};
}

/** The profile every library call of this plugin is parameterized with. */
export const atlassianProfile = (config: Config): OAuthProviderProfile => {
	return {
		scope: PLUGIN_NAME,
		label: "Atlassian",
		instance: DEFAULT_INSTANCE,
		endpoint: config.endpoint,
		toolNamespace: "atlassian",
		debug: config.debug,
		oauth: {
			redirectPort: config.redirectPort,
			scopes: DESIRED_SCOPES,
			fallbackScopes: FALLBACK_SCOPES,
			clientName: "DeepSeek Harness",
		},
	};
};

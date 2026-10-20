/**
 * Sentry configuration, and the provider profile built from it.
 *
 * The scope list is Sentry's, not the library's: it is what the MCP server
 * advertises, and the library narrows it to what discovery reports anyway.
 */

import { DEFAULT_INSTANCE, type OAuthProviderProfile } from "dsh-mcp-oauth";

/** Sentry's remote MCP resource. */
export const DEFAULT_ENDPOINT = "https://mcp.sentry.dev/mcp";

/** First loopback port tried for the OAuth redirect. */
export const DEFAULT_REDIRECT_PORT = 8144;

/** The name this plugin is registered under; it owns the credential record. */
export const PLUGIN_NAME = "dsh-sentry";

/** Scopes wanted; whatever is not advertised is dropped. */
const DESIRED_SCOPES = [
	"org:read",
	"project:write",
	"team:write",
	"event:write",
	"alerts:write",
];

/** What is asked for when a server advertises no scopes at all. */
const FALLBACK_SCOPES = ["org:read", "project:write"];

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
export const sentryProfile = (config: Config): OAuthProviderProfile => {
	return {
		scope: PLUGIN_NAME,
		label: "Sentry",
		instance: DEFAULT_INSTANCE,
		endpoint: config.endpoint,
		toolNamespace: "sentry",
		debug: config.debug,
		oauth: {
			redirectPort: config.redirectPort,
			scopes: DESIRED_SCOPES,
			fallbackScopes: FALLBACK_SCOPES,
			clientName: "DeepSeek Harness",
		},
	};
};

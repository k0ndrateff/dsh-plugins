/**
 * Sentry configuration, and the provider profile built from it.
 *
 * The scope list is Sentry's, not the library's: it is what the MCP server
 * advertises, and the library narrows it to what discovery reports anyway.
 */

import {
	type ConfigInput,
	type EndpointConfig,
	resolveEndpointConfig,
} from "dsh-integration-host";
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

export type { ConfigInput };

/**
 * Normalize whatever the loader passed against Sentry's own defaults.
 * @param input - `endpoint`, `redirectPort`, and `debug` from the bundle patch.
 */
export const resolveConfig = (
	input: ConfigInput | undefined,
): EndpointConfig => {
	return resolveEndpointConfig(input, {
		endpoint: DEFAULT_ENDPOINT,
		redirectPort: DEFAULT_REDIRECT_PORT,
	});
};

/** The profile every library call of this plugin is parameterized with. */
export const sentryProfile = (config: EndpointConfig): OAuthProviderProfile => {
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

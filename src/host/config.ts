/**
 * Plugin configuration, as it arrives from the bundle patch in
 * `cordis.patch.yml` and any profile override.
 */

/** Atlassian's v1 MCP resource; the default because it needs no extra setup. */
export const DEFAULT_ENDPOINT = "https://mcp.atlassian.com/v1/mcp";

/** First loopback port tried for the OAuth redirect. */
export const DEFAULT_REDIRECT_PORT = 8143;

/** How many consecutive ports to try when the preferred one is taken. */
export const PORT_ATTEMPTS = 20;

/** Give up on a sign-in the user never finishes. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** Refresh this long before the access token actually expires. */
export const REFRESH_MARGIN_MS = 60_000;

/** Network calls that are not the user's own pace. */
export const REQUEST_TIMEOUT_MS = 30_000;

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

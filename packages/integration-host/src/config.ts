/**
 * The endpoint configuration every integration is parameterized with.
 *
 * A profile patch may carry an endpoint, a redirect port, and a debug flag;
 * this normalizes whatever arrived. Unknown or malformed fields fall back to the
 * provider's defaults rather than failing activation, because a typo in a patch
 * should not take a plugin down.
 */

/** Raw shape accepted from the profile patch. */
export interface ConfigInput {
	readonly endpoint?: unknown;
	readonly redirectPort?: unknown;
	readonly debug?: unknown;
}

/** Resolved configuration: every field present and of the right type. */
export interface EndpointConfig {
	readonly endpoint: string;
	readonly redirectPort: number;
	readonly debug: boolean;
}

/** What a provider falls back to when the patch names nothing. */
export interface ConfigDefaults {
	/** The provider's own MCP resource. */
	readonly endpoint: string;
	/** The first loopback port tried for the OAuth redirect. */
	readonly redirectPort: number;
}

/**
 * Normalize one patch against a provider's defaults.
 * @param input - whatever the loader passed.
 * @param defaults - the provider's own resource and port.
 * @returns the configuration every library call is parameterized with.
 */
export function resolveEndpointConfig(
	input: ConfigInput | undefined,
	defaults: ConfigDefaults,
): EndpointConfig {
	const endpoint =
		typeof input?.endpoint === "string" && input.endpoint !== ""
			? input.endpoint
			: defaults.endpoint;

	const port = Number(input?.redirectPort);

	return {
		endpoint,
		redirectPort:
			Number.isInteger(port) && port > 0 && port < 65_536
				? port
				: defaults.redirectPort,
		debug: input?.debug === true,
	};
}

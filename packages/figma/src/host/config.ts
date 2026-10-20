/**
 * Figma configuration.
 *
 * The Dev Mode MCP server runs inside the Figma desktop app and is reached at a
 * fixed loopback address, so there is no instance to choose, no scope to ask
 * for, and no redirect port: this normalizes its own two fields rather than
 * borrowing the shared resolver, whose shape is the OAuth flow's.
 *
 * Unknown or malformed fields fall back to the defaults rather than failing
 * activation, because a typo in a patch should not take a plugin down.
 */

/** Raw shape accepted from the profile patch. */
export interface ConfigInput {
	/** The MCP resource the Dev Mode server answers on. */
	readonly endpoint?: unknown;
	readonly debug?: unknown;
}

/** Resolved configuration: every field present and of the right type. */
export interface FigmaConfig {
	readonly endpoint: string;
	readonly debug: boolean;
}

/** The address the Figma desktop app serves its MCP server on. */
export const DEFAULT_ENDPOINT = "http://127.0.0.1:3845/mcp";

/** The name this plugin is registered under; it owns the MCP namespace. */
export const PLUGIN_NAME = "dsh-figma";

/**
 * Normalize whatever the loader passed against Figma's own defaults.
 * @param input - `endpoint` and `debug` from the bundle patch.
 */
export const resolveConfig = (input: ConfigInput | undefined): FigmaConfig => {
	const endpoint =
		typeof input?.endpoint === "string" && input.endpoint.trim() !== ""
			? input.endpoint.trim().replace(/\/+$/u, "")
			: DEFAULT_ENDPOINT;

	return { endpoint, debug: input?.debug === true };
};

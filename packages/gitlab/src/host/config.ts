/**
 * GitLab configuration.
 *
 * A REST integration needs less than an OAuth one: the instance to talk to, and
 * whether to log payloads. The redirect port an OAuth profile carries has no
 * meaning here, so this normalizes its own two fields rather than borrowing the
 * shared resolver, whose shape is the OAuth flow's.
 *
 * Unknown or malformed fields fall back to the defaults rather than failing
 * activation, because a typo in a patch should not take a plugin down.
 */

/** Raw shape accepted from the profile patch. */
export interface ConfigInput {
	/** The GitLab instance's own root, such as `https://gitlab.com`. */
	readonly endpoint?: unknown;
	readonly debug?: unknown;
}

/** Resolved configuration: every field present and of the right type. */
export interface GitLabConfig {
	readonly endpoint: string;
	readonly debug: boolean;
}

/** GitLab.com, which is the instance this plugin is written against. */
export const DEFAULT_ENDPOINT = "https://gitlab.com";

/** The name this plugin is registered under; it owns the credential record. */
export const PLUGIN_NAME = "dsh-gitlab";

/** The scope every GitLab REST path lives under. */
const API_PATH = "/api/v4";

/**
 * Normalize whatever the loader passed against GitLab's own defaults.
 * @param input - `endpoint` and `debug` from the bundle patch.
 */
export const resolveConfig = (input: ConfigInput | undefined): GitLabConfig => {
	const endpoint =
		typeof input?.endpoint === "string" && input.endpoint.trim() !== ""
			? input.endpoint.trim().replace(/\/+$/u, "")
			: DEFAULT_ENDPOINT;

	return { endpoint, debug: input?.debug === true };
};

/** The API root every REST call is made against. */
export const apiRootOf = (config: GitLabConfig): string =>
	`${config.endpoint}${API_PATH}`;

/**
 * What the library needs to know about one OAuth-protected MCP server.
 *
 * Every provider-specific fact enters through here: the library itself never
 * names a vendor, a scope vocabulary, or a credential record. A plugin builds
 * one profile from its own configuration and hands it to the pieces below.
 */

/** One provider's identity, endpoints, and scope vocabulary. */
export interface ProviderProfile {
	/** Stable id, unique per plugin. Names connection state and log lines. */
	readonly id: string;
	/** Label for notices and errors ("Atlassian", "GitLab"). */
	readonly label: string;
	/** MCP resource URL; also the RFC 8707 `resource` parameter. */
	readonly endpoint: string;
	/** First loopback port to try for the redirect. */
	readonly redirectPort: number;
	/** Scopes to ask for, most wanted first. */
	readonly scopes: readonly string[];
	/** What to ask for when the server advertises no scopes at all. */
	readonly fallbackScopes: readonly string[];
	/** Name shown on the consent screen. */
	readonly clientName: string;
	/** Published tools live under `mcp__<namespace>__<tool>`. */
	readonly toolNamespace: string;
	/** Credential record key, in the store's `<scope>/<id>` grammar. */
	readonly credentialKey: string;
	/** Log the raw MCP payload of every tool result. */
	readonly debug: boolean;
}

/** The credential key a provider gets when its plugin names none. */
export function credentialKeyFor(pluginName: string): string {
	return `${pluginName}/mcp`;
}

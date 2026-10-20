/**
 * What the library needs to know about one MCP server it talks to.
 *
 * Every provider-specific fact enters through here: the library itself never
 * names a vendor, a scope vocabulary, or a credential record. A plugin builds
 * one profile per account and hands it to the pieces below.
 */

import { credentialKeyFor, DEFAULT_INSTANCE } from "./account";

/**
 * The OAuth facts of a profile, absent for a server that needs no credentials.
 *
 * They are grouped rather than spread over the profile because they are the
 * half a local MCP server has nothing to say about.
 */
export interface OAuthProfile {
	/** First loopback port to try for the redirect. */
	readonly redirectPort: number;
	/** Scopes to ask for, most wanted first. */
	readonly scopes: readonly string[];
	/** What to ask for when the server advertises no scopes at all. */
	readonly fallbackScopes: readonly string[];
	/** Name shown on the consent screen. */
	readonly clientName: string;
}

/** One provider account: its identity, its server, and how it authenticates. */
export interface ProviderProfile {
	/** The owning plugin's registered name; owns the record and names log lines. */
	readonly scope: string;
	/** User-facing provider name ("Atlassian", "GitLab"). */
	readonly label: string;
	/** Account within the provider; the default one unless the plugin runs several. */
	readonly instance: string;
	/** MCP resource URL; also the RFC 8707 `resource` parameter. */
	readonly endpoint: string;
	/** Published tools live under `mcp__<namespace>__<tool>`. */
	readonly toolNamespace: string;
	/** Log the raw MCP payload of every tool result. */
	readonly debug: boolean;
	/** Absent for a server reached with no credentials at all, such as a local MCP. */
	readonly oauth?: OAuthProfile;
}

/** A profile whose server is reached through OAuth. */
export type OAuthProviderProfile = ProviderProfile & {
	readonly oauth: OAuthProfile;
};

/** A profile whose server is reached with no credentials at all. */
export type NoAuthProviderProfile = ProviderProfile & {
	readonly oauth?: undefined;
};

/** Whether a profile's server is reached through OAuth. */
export function needsOAuth(
	profile: ProviderProfile,
): profile is OAuthProviderProfile {
	return profile.oauth !== undefined;
}

/** The credential record one account's tokens live in. */
export function credentialKeyOf(profile: OAuthProviderProfile): string {
	return credentialKeyFor(profile.scope, profile.instance);
}

/** How one account names itself in log lines: `dsh-gitlab` or `dsh-gitlab/work`. */
export function accountLabel(profile: ProviderProfile): string {
	return profile.instance === DEFAULT_INSTANCE
		? profile.scope
		: `${profile.scope}/${profile.instance}`;
}

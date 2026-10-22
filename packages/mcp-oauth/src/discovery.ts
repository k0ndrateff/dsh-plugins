/**
 * OAuth discovery for one MCP resource.
 *
 * Servers differ in exactly the ways this walks around: some publish RFC 9728
 * protected-resource metadata naming a separate authorization server, some are
 * their own issuer, and the metadata itself may sit at the origin root or under
 * the issuer's path. So both document families are tried most-specific-first
 * and the first usable answer wins.
 *
 * The requested scopes are the provider's, narrowed to what the server
 * advertises: one profile serves a server that renamed its whole scope
 * vocabulary, which is what Atlassian's second generation did.
 */

import { network } from "./net";
import type { OAuthProviderProfile } from "./provider";
import { chooseTokenAuthMethod, OAuthServer } from "./server";

/**
 * Resolve the authorization server for one MCP resource.
 * @param profile - the provider: its resource URL and wanted scopes.
 * @returns the discovered server, its endpoints, and the chosen scopes.
 * @throws when no authorization-server metadata can be read at all.
 */
export async function discover(
	profile: OAuthProviderProfile,
): Promise<OAuthServer> {
	const endpoint = profile.endpoint;
	let protectedResource: Record<string, unknown> | undefined;
	let issuer = new URL(endpoint).origin;

	for (const candidate of protectedResourceCandidates(endpoint)) {
		const document = await network.getJSON(candidate);
		const servers = stringList(document?.authorization_servers);

		if (document !== undefined && servers !== undefined) {
			protectedResource = document;
			issuer = servers[0] ?? issuer;

			break;
		}
	}

	let metadata: Record<string, unknown> | undefined;
	for (const candidate of authorizationServerCandidates(issuer)) {
		const document = await network.getJSON(candidate);

		if (firstString(document?.token_endpoint) !== undefined) {
			metadata = document;
			break;
		}
	}

	if (metadata === undefined)
		throw new Error(`no OAuth metadata for ${endpoint} (issuer ${issuer})`);

	const authorizationEndpoint = secureEndpoint(
		firstString(metadata.authorization_endpoint),
		"the authorization endpoint",
	);
	const tokenEndpoint = secureEndpoint(
		firstString(metadata.token_endpoint),
		"the token endpoint",
	);

	if (authorizationEndpoint === undefined || tokenEndpoint === undefined)
		throw new Error(`incomplete OAuth metadata for ${issuer}`);

	// The resource's own document is the more specific scope list when present.
	const advertised =
		stringList(protectedResource?.scopes_supported) ??
		stringList(metadata.scopes_supported);
	const scopes = chooseScopes(profile, advertised);
	const registrationEndpoint = secureEndpoint(
		firstString(metadata.registration_endpoint),
		"the registration endpoint",
	);
	const revocationEndpoint = secureEndpoint(
		firstString(metadata.revocation_endpoint),
		"the revocation endpoint",
	);

	return new OAuthServer({
		issuer:
			secureEndpoint(firstString(metadata.issuer) ?? issuer, "the issuer") ??
			issuer,
		resource: endpoint,
		authorizationEndpoint,
		tokenEndpoint,
		scopes,
		scopeString: scopes.join(" "),
		tokenAuthMethod: chooseTokenAuthMethod(
			stringList(metadata.token_endpoint_auth_methods_supported),
		),
		...(registrationEndpoint === undefined ? {} : { registrationEndpoint }),
		...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
	});
}

/** Well-known protected-resource locations for a resource, most specific first. */
function protectedResourceCandidates(endpoint: string): string[] {
	const url = new URL(endpoint);
	const path = url.pathname.replace(/\/+$/u, "");

	return [
		`${url.origin}/.well-known/oauth-protected-resource${path}`,
		`${url.origin}/.well-known/oauth-protected-resource`,
	];
}

/**
 * Well-known authorization-server locations for an issuer.
 *
 * RFC 8414 inserts the well-known segment before the issuer's path; some
 * servers instead append it, and OpenID Connect appends `/openid-configuration`,
 * so all of them are tried.
 */
function authorizationServerCandidates(issuer: string): string[] {
	const url = new URL(issuer);
	const path = url.pathname.replace(/\/+$/u, "");
	const bare = issuer.replace(/\/+$/u, "");

	return [
		`${url.origin}/.well-known/oauth-authorization-server${path}`,
		`${bare}/.well-known/oauth-authorization-server`,
		`${url.origin}/.well-known/openid-configuration${path}`,
		`${bare}/.well-known/openid-configuration`,
	];
}

/**
 * Choose the scope set to request: what the provider wants, narrowed to what
 * the server advertises. A server that advertises nothing gets the provider's
 * fallback set, and `offline_access` is preserved whenever it is offered,
 * because that is what buys a refresh token.
 */
function chooseScopes(
	profile: OAuthProviderProfile,
	advertised: readonly string[] | undefined,
): string[] {
	const wanted = profile.oauth.scopes;

	if (advertised === undefined || advertised.length === 0)
		return [...profile.oauth.fallbackScopes];

	const chosen = wanted.filter((scope) => advertised.includes(scope));

	if (chosen.length > 0) return chosen;

	return advertised.includes("offline_access")
		? ["offline_access"]
		: [...profile.oauth.fallbackScopes];
}

/**
 * One endpoint from OAuth metadata, refused unless it can be trusted with a token.
 *
 * RFC 8414 and 9728 require TLS. A loopback server is the one exception an MCP
 * deployment actually uses, and it never leaves the machine. A `javascript:`
 * authorization endpoint would otherwise reach the settings card's link, and an
 * `http:` token endpoint would send the refresh token in clear text.
 * @param value - the endpoint as the server published it, when it published one.
 * @param what - the field's name, for the refusal.
 * @throws when the value is not an absolute http(s) URL.
 */
function secureEndpoint(
	value: string | undefined,
	what: string,
): string | undefined {
	if (value === undefined) return undefined;

	let url: URL;

	try {
		url = new URL(value);
	} catch {
		throw new Error(`${what} is not a URL`);
	}

	const loopback =
		url.hostname === "127.0.0.1" ||
		url.hostname === "localhost" ||
		url.hostname === "[::1]";

	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
		throw new Error(`${what} must use https`);

	return value;
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const items = value.filter(
		(item): item is string => typeof item === "string",
	);

	return items.length > 0 ? items : undefined;
}

function firstString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * OAuth discovery for one MCP resource.
 *
 * The two Atlassian generations differ exactly here: `/v2/mcp` publishes RFC
 * 9728 protected-resource metadata naming a separate authorization server,
 * while `/v1/mcp` publishes none and is its own issuer. Both are handled by
 * trying the specific metadata locations first and falling back to the
 * resource's own origin.
 */

import { network } from "../net";
import { OAuthServer } from "./server";

class OAuthDiscovery {
	/**
	 * Scopes this plugin wants, across both generations. Whatever the server does
	 * not advertise is dropped, so one list serves the classic v1 names and the
	 * newer `:agent-interface` families.
	 */
	private readonly DESIRED_SCOPES = [
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
	private readonly FALLBACK_SCOPES = [
		"offline_access",
		"read:jira-work",
		"write:jira-work",
		"read:jira-user",
		"read:page:confluence",
		"write:page:confluence",
		"search:confluence",
		"read:space:confluence",
	];

	/**
	 * Resolve the authorization server for an MCP resource.
	 * @param endpoint - the MCP resource URL.
	 * @returns the discovered server, its advertised endpoints, and the scopes.
	 * @throws when no authorization-server metadata can be read at all.
	 */
	discover = async (endpoint: string): Promise<OAuthServer> => {
		let protectedResource: Record<string, unknown> | undefined;
		let issuer = new URL(endpoint).origin;

		for (const candidate of this.protectedResourceCandidates(endpoint)) {
			const document = await network.getJSON(candidate);
			const servers = this.stringList(document?.authorization_servers);

			if (document !== undefined && servers !== undefined) {
				protectedResource = document;
				issuer = servers[0] ?? issuer;

				break;
			}
		}

		let metadata: Record<string, unknown> | undefined;
		for (const candidate of this.authorizationServerCandidates(issuer)) {
			const document = await network.getJSON(candidate);

			if (this.firstString(document?.token_endpoint) !== undefined) {
				metadata = document;
				break;
			}
		}

		if (metadata === undefined)
			throw new Error(`no OAuth metadata for ${endpoint} (issuer ${issuer})`);

		const authorizationEndpoint = this.firstString(
			metadata.authorization_endpoint,
		);
		const tokenEndpoint = this.firstString(metadata.token_endpoint);

		if (authorizationEndpoint === undefined || tokenEndpoint === undefined)
			throw new Error(`incomplete OAuth metadata for ${issuer}`);

		// The resource's own document is the more specific scope list when present.
		const advertised =
			this.stringList(protectedResource?.scopes_supported) ??
			this.stringList(metadata.scopes_supported);
		const scopes = this.chooseScopes(advertised);
		const registrationEndpoint = this.firstString(
			metadata.registration_endpoint,
		);
		const revocationEndpoint = this.firstString(metadata.revocation_endpoint);

		return new OAuthServer({
			issuer: this.firstString(metadata.issuer) ?? issuer,
			resource: endpoint,
			authorizationEndpoint,
			tokenEndpoint,
			scopes,
			scopeString: scopes.join(" "),
			...(registrationEndpoint === undefined ? {} : { registrationEndpoint }),
			...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
		});
	};

	/** Well-known protected-resource locations for a resource, most specific first. */
	private protectedResourceCandidates = (endpoint: string): string[] => {
		const url = new URL(endpoint);
		const path = url.pathname.replace(/\/+$/u, "");

		return [
			`${url.origin}/.well-known/oauth-protected-resource${path}`,
			`${url.origin}/.well-known/oauth-protected-resource`,
		];
	};

	/**
	 * Well-known authorization-server locations for an issuer. RFC 8414 inserts the
	 * well-known segment before the issuer's path; some servers instead append it,
	 * and OpenID Connect appends `/openid-configuration`, so all are tried.
	 */
	private authorizationServerCandidates = (issuer: string): string[] => {
		const url = new URL(issuer);
		const path = url.pathname.replace(/\/+$/u, "");
		const bare = issuer.replace(/\/+$/u, "");

		return [
			`${url.origin}/.well-known/oauth-authorization-server${path}`,
			`${bare}/.well-known/oauth-authorization-server`,
			`${url.origin}/.well-known/openid-configuration${path}`,
			`${bare}/.well-known/openid-configuration`,
		];
	};

	/**
	 * Choose the scope set to request: what we want, narrowed to what the server
	 * advertises. A server that advertises nothing gets the classic v1 set, and
	 * `offline_access` is preserved whenever it is offered because that is what
	 * buys a refresh token.
	 */
	private chooseScopes = (
		advertised: readonly string[] | undefined,
	): string[] => {
		if (advertised === undefined || advertised.length === 0)
			return [...this.FALLBACK_SCOPES];

		const wanted = this.DESIRED_SCOPES.filter((scope) =>
			advertised.includes(scope),
		);

		if (wanted.length > 0) return wanted;

		return advertised.includes("offline_access")
			? ["offline_access"]
			: [...this.FALLBACK_SCOPES];
	};

	private stringList = (value: unknown): string[] | undefined => {
		if (!Array.isArray(value)) return undefined;

		const items = value.filter(
			(item): item is string => typeof item === "string",
		);

		return items.length > 0 ? items : undefined;
	};

	private firstString = (value: unknown): string | undefined => {
		return typeof value === "string" && value !== "" ? value : undefined;
	};
}

export const oauthDiscovery = new OAuthDiscovery();

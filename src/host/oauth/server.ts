/**
 * Everything the OAuth flow needs to talk to one authorization server: the
 * resolved endpoints, dynamic client registration, and the token endpoint.
 *
 * Atlassian runs two generations of its MCP server, and they are separate OAuth
 * resources with different authorization servers and different scope
 * vocabularies. Nothing here is hard-coded to either: the endpoints come from
 * discovery, and the requested scopes are intersected with what the server
 * actually advertises.
 */

import { network } from "../net";
import type { Grant } from "../store/grant";

interface RegisteredClient {
	clientId: string;
	clientSecret?: string;
}

/** A discovered authorization server plus the scope set chosen for it. */
export class OAuthServer {
	/** Issuer identifier, used to detect a generation switch. */
	readonly issuer: string;
	/** MCP resource URL the tokens are scoped to (RFC 8707 `resource`). */
	readonly resource: string;
	readonly authorizationEndpoint: string;
	readonly tokenEndpoint: string;
	readonly registrationEndpoint?: string;
	readonly revocationEndpoint?: string;
	readonly scopes: readonly string[];
	/** The space-delimited `scope` parameter. */
	readonly scopeString: string;

	constructor(
		params: Pick<
			OAuthServer,
			| "issuer"
			| "resource"
			| "authorizationEndpoint"
			| "tokenEndpoint"
			| "registrationEndpoint"
			| "revocationEndpoint"
			| "scopes"
			| "scopeString"
		>,
	) {
		this.issuer = params.issuer;
		this.resource = params.resource;
		this.authorizationEndpoint = params.authorizationEndpoint;
		this.tokenEndpoint = params.tokenEndpoint;
		this.registrationEndpoint = params.registrationEndpoint;
		this.revocationEndpoint = params.revocationEndpoint;
		this.scopes = params.scopes;
		this.scopeString = params.scopeString;
	}

	/** Register this installation as a public client (RFC 7591, no secret). */
	registerClient = async (
		redirectUri: string,
		clientName: string,
	): Promise<RegisteredClient> => {
		if (this.registrationEndpoint === undefined)
			throw new Error(`${this.issuer} offers no dynamic client registration`);

		const body = await network.postJSON(
			this.registrationEndpoint,
			{
				client_name: clientName,
				redirect_uris: [redirectUri],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
				scope: this.scopeString,
			},
			"Atlassian client registration",
		);

		const clientId = body.client_id;

		if (typeof clientId !== "string" || clientId === "")
			throw new Error("Atlassian client registration returned no client_id");

		// Some generations hand a secret to public clients anyway; keep it if so.
		const clientSecret =
			typeof body.client_secret === "string" ? body.client_secret : undefined;

		return clientSecret === undefined
			? { clientId }
			: { clientId, clientSecret };
	};

	/** Exchange an authorization code, or a refresh token, for tokens. */
	tokenRequest = async (
		client: Pick<Grant, "clientId" | "clientSecret"> | undefined,
		body: Record<string, string>,
	): Promise<Record<string, unknown>> => {
		const fields: Record<string, string> = {
			...body,
			resource: this.resource,
		};

		if (client?.clientId !== undefined) fields.client_id = client.clientId;

		if (client?.clientSecret !== undefined)
			fields.client_secret = client.clientSecret;

		return await network.postForm(
			this.tokenEndpoint,
			fields,
			"Atlassian token request",
		);
	};

	/**
	 * Map a token-endpoint response onto grant fields, keeping what the response
	 * omits. Atlassian rotates refresh tokens, so a response that carries one
	 * replaces the stored value; one that does not leaves it alone.
	 */
	toTokenFields = (
		payload: Record<string, unknown>,
		previous: Pick<
			Grant,
			"accessToken" | "refreshToken" | "tokenType" | "scope"
		>,
	): Pick<
		Grant,
		"accessToken" | "refreshToken" | "tokenType" | "scope" | "expiresAt"
	> => {
		const expiresIn = Number(payload.expires_in);

		return {
			accessToken:
				typeof payload.access_token === "string"
					? payload.access_token
					: previous.accessToken,
			refreshToken:
				typeof payload.refresh_token === "string"
					? payload.refresh_token
					: previous.refreshToken,
			tokenType:
				typeof payload.token_type === "string"
					? payload.token_type
					: previous.tokenType,
			scope: typeof payload.scope === "string" ? payload.scope : previous.scope,
			expiresAt:
				Date.now() +
				(Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
		};
	};
}

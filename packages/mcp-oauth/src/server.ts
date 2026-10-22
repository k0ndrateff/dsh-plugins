/**
 * Everything the OAuth flow needs to talk to one authorization server: the
 * resolved endpoints, dynamic client registration, and the token endpoint.
 *
 * One vendor may run several generations of its MCP server, each a separate
 * OAuth resource with its own authorization server and scope vocabulary.
 * Nothing here is hard-coded to any of them: the endpoints come from discovery,
 * and the requested scopes are intersected with what the server advertises.
 */

import type { Grant } from "./grant";
import { network } from "./net";

/** How a client authenticates at the token endpoint. */
export type TokenAuthMethod =
	| "none"
	| "client_secret_post"
	| "client_secret_basic";

/** What dynamic client registration issued. */
export interface RegisteredClient {
	readonly clientId: string;
	readonly clientSecret?: string;
	readonly tokenAuthMethod: TokenAuthMethod;
}

/**
 * The client authentication to register with.
 *
 * A public client is preferred whenever the server allows one: PKCE already
 * binds the code to this installation, so nothing has to be stored. A server
 * that offers no `none` gets a secret instead. What it actually issued is what
 * counts afterwards, because a registration endpoint may ignore the request and
 * hand back a public client anyway.
 * @param advertised - the server's `token_endpoint_auth_methods_supported`.
 */
export function chooseTokenAuthMethod(
	advertised: readonly string[] | undefined,
): TokenAuthMethod {
	if (advertised === undefined || advertised.includes("none")) return "none";

	if (advertised.includes("client_secret_post")) return "client_secret_post";

	if (advertised.includes("client_secret_basic")) return "client_secret_basic";

	return "none";
}

/**
 * The client authentication a stored client uses.
 *
 * A record may carry no method — only whether it holds a secret — and then the
 * secret decides: a client with one posts it, a client without one is public.
 */
export function authMethodOf(
	client: Pick<Grant, "clientSecret" | "tokenAuthMethod">,
): TokenAuthMethod {
	if (client.tokenAuthMethod !== undefined) return client.tokenAuthMethod;

	return client.clientSecret === undefined ? "none" : "client_secret_post";
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
	/** Client authentication to ask for at registration. */
	readonly tokenAuthMethod: TokenAuthMethod;

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
			| "tokenAuthMethod"
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
		this.tokenAuthMethod = params.tokenAuthMethod;
	}

	/** Register this installation as a client (RFC 7591). */
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
				token_endpoint_auth_method: this.tokenAuthMethod,
				scope: this.scopeString,
			},
			"dynamic client registration",
		);

		const clientId = body.client_id;

		if (typeof clientId !== "string" || clientId === "")
			throw new Error("client registration returned no client_id");

		const clientSecret =
			typeof body.client_secret === "string" ? body.client_secret : undefined;
		const tokenAuthMethod =
			readTokenAuthMethod(body.token_endpoint_auth_method) ??
			(clientSecret === undefined ? "none" : this.tokenAuthMethod);

		return clientSecret === undefined
			? { clientId, tokenAuthMethod }
			: { clientId, clientSecret, tokenAuthMethod };
	};

	/** Exchange an authorization code, or a refresh token, for tokens. */
	tokenRequest = async (
		client: Pick<Grant, "clientId" | "clientSecret" | "tokenAuthMethod">,
		body: Record<string, string>,
	): Promise<Record<string, unknown>> => {
		const { clientId, clientSecret } = client;
		const method = authMethodOf(client);
		const fields: Record<string, string> = {
			...body,
			resource: this.resource,
		};

		if (method === "client_secret_basic") {
			if (clientId === undefined || clientSecret === undefined)
				throw new Error("client_secret_basic needs a client id and secret");

			return await network.postForm(
				this.tokenEndpoint,
				fields,
				"token request",
				basicAuth(clientId, clientSecret),
			);
		}

		if (clientId !== undefined) fields.client_id = clientId;

		if (method === "client_secret_post" && clientSecret !== undefined)
			fields.client_secret = clientSecret;

		return await network.postForm(this.tokenEndpoint, fields, "token request");
	};

	/**
	 * Map a token-endpoint response onto grant fields, keeping what the response
	 * omits. Servers that rotate refresh tokens send a new one, and a response
	 * that carries one replaces the stored value; one that does not leaves it
	 * alone.
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
		const accessToken = payload.access_token;
		const refreshToken = payload.refresh_token;
		const tokenType = payload.token_type;

		return {
			accessToken:
				typeof accessToken === "string" && accessToken !== ""
					? accessToken
					: previous.accessToken,
			refreshToken:
				typeof refreshToken === "string" && refreshToken !== ""
					? refreshToken
					: previous.refreshToken,
			tokenType:
				typeof tokenType === "string" && tokenType !== ""
					? tokenType
					: previous.tokenType,
			scope: typeof payload.scope === "string" ? payload.scope : previous.scope,
			expiresAt:
				Date.now() +
				(Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
		};
	};
}

/** The `Authorization` header a confidential client authenticates with. */
function basicAuth(clientId: string, clientSecret: string): string {
	const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;

	return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/** One of the three methods the library understands, or undefined. */
function readTokenAuthMethod(value: unknown): TokenAuthMethod | undefined {
	return value === "none" ||
		value === "client_secret_post" ||
		value === "client_secret_basic"
		? value
		: undefined;
}

/**
 * The durable credential record and the token lifetime logic over it.
 *
 * A record is written under the store's `<scope>/<id>` key, and its payload is
 * plain JSON: what comes back from disk is not an instance, which is why every
 * read path goes through {@link Grant.from} and callers only ever see a real
 * `Grant`.
 *
 * Tokens refresh inside `modifyRecord`, whose lock spans the network round
 * trip, so two processes can never rotate the same refresh token twice.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { CredentialKey } from "@deepseek-ai/dsh-credentials";
import { REFRESH_MARGIN_MS } from "./config";
import { type JsonValue, jsonSafe } from "./json";
import type { OAuthServer } from "./server";

/** Provider-owned facts kept beside the tokens. */
export type GrantExtra = Readonly<Record<string, JsonValue>>;

/** A grant that definitely carries an access token. */
export type SignedInGrant = Grant & { accessToken: string };

/** What a successful sign-in stores. */
export class Grant {
	readonly version: 1;
	/** Issuer the tokens came from, so a generation switch is detectable. */
	readonly issuer?: string;
	/** MCP resource the tokens are valid for (RFC 8707). */
	readonly resource?: string;
	/** Dynamically registered client identity. */
	readonly clientId?: string;
	/** Present only for a server that issues one, which a confidential client requires. */
	readonly clientSecret?: string;
	/** The exact redirect URI the client was registered with. */
	readonly redirectUri?: string;
	/** Application data the provider keeps with its tokens. */
	readonly extra?: GrantExtra;
	readonly accessToken?: string;
	readonly refreshToken?: string;
	readonly tokenType?: string;
	readonly scope?: string;
	readonly expiresAt?: number;

	constructor(params: Omit<Grant, "isSignedIn">) {
		this.version = params.version;
		this.issuer = params.issuer;
		this.resource = params.resource;
		this.clientId = params.clientId;
		this.clientSecret = params.clientSecret;
		this.redirectUri = params.redirectUri;
		this.extra = params.extra;
		this.accessToken = params.accessToken;
		this.refreshToken = params.refreshToken;
		this.tokenType = params.tokenType;
		this.scope = params.scope;
		this.expiresAt = params.expiresAt;
	}

	/**
	 * Rebuild a grant from a stored payload.
	 * @param payload - whatever the credential store returned.
	 * @returns the grant, or undefined for a payload that is not an object.
	 */
	static from(payload: unknown): Grant | undefined {
		if (payload === null || typeof payload !== "object") return undefined;

		return new Grant(payload as Omit<Grant, "isSignedIn">);
	}

	/** Whether a stored grant carries a usable access token. */
	isSignedIn(): this is SignedInGrant {
		return typeof this.accessToken === "string" && this.accessToken !== "";
	}
}

/** One provider's record in the credential store. */
export class GrantStore {
	/** The record key, as the harness authorization seam spells it. */
	readonly credentialKey: CredentialKey;

	/**
	 * @param ctx - host context carrying the credential store.
	 * @param key - the record key, in the store's `<scope>/<id>` grammar.
	 */
	constructor(
		private readonly ctx: Context,
		key: string,
	) {
		this.credentialKey = key as CredentialKey;
	}

	/** Read the stored grant, or undefined when there is none. */
	async read(): Promise<Grant | undefined> {
		const record = await this.ctx.credentials.readRecord(this.credentialKey);

		if (record === undefined || record.kind !== "grant") return undefined;

		return Grant.from(record.payload);
	}

	/**
	 * Read-decide-replace the grant under the store's cross-process lock.
	 * @param mutate - receives the current grant; returning undefined leaves it alone.
	 * @returns the stored grant after the change.
	 */
	async mutate(
		mutate: (current: Grant | undefined) => Promise<Grant | undefined>,
	): Promise<Grant | undefined> {
		const record = await this.ctx.credentials.modifyRecord(
			this.credentialKey,
			async (current) => {
				const previous =
					current?.kind === "grant" ? Grant.from(current.payload) : undefined;

				const next = await mutate(previous);
				if (next === undefined) return undefined;

				// The store refuses a value JSON cannot represent, and a token response
				// omits fields the previous grant carried.
				const payload = jsonSafe(next);
				if (payload === undefined) return undefined;

				return { kind: "grant", payload };
			},
		);

		return record?.kind === "grant" ? Grant.from(record.payload) : undefined;
	}

	/** Merge provider facts into the record, creating it when absent. */
	async remember(patch: GrantExtra): Promise<void> {
		await this.mutate(
			async (grant) =>
				new Grant({
					...(grant ?? { version: 1 as const }),
					version: 1,
					extra: { ...grant?.extra, ...patch },
				}),
		);
	}

	/** Forget the record entirely; the issuer is not told, matching the seam. */
	async clear(): Promise<void> {
		await this.ctx.credentials.deleteRecord(this.credentialKey);
	}

	/**
	 * The token an MCP transport asks for before every request, refreshed when
	 * it is about to expire.
	 * @param oauth - the authorization server the tokens belong to.
	 * @returns the access token, or undefined when nobody is signed in.
	 */
	async accessToken(oauth: OAuthServer): Promise<string | undefined> {
		const grant = await this.read();

		if (grant === undefined || !grant.isSignedIn()) return undefined;

		if (Date.now() < (grant.expiresAt ?? 0) - REFRESH_MARGIN_MS)
			return grant.accessToken;

		return await this.refresh(oauth);
	}

	/**
	 * Exchange the refresh token for a new access token, inside the store lock.
	 * A peer that refreshed while we waited makes this a no-op.
	 * @param oauth - the authorization server to refresh against.
	 * @throws when the record carries no refresh token, or nobody is signed in.
	 */
	async refresh(oauth: OAuthServer): Promise<string> {
		const after = await this.mutate(async (grant) => {
			if (grant === undefined) return undefined;

			if (Date.now() < (grant.expiresAt ?? 0) - REFRESH_MARGIN_MS)
				return undefined;

			if (typeof grant.refreshToken !== "string" || grant.refreshToken === "")
				throw new Error(
					"the stored sign-in has no refresh token; sign in again",
				);

			const payload = await oauth.tokenRequest(grant, {
				grant_type: "refresh_token",
				refresh_token: grant.refreshToken,
			});

			return new Grant({ ...grant, ...oauth.toTokenFields(payload, grant) });
		});

		if (after === undefined || !after.isSignedIn())
			throw new Error("not signed in");

		return after.accessToken;
	}
}

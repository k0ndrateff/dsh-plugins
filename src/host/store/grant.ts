/**
 * The durable credential record this plugin owns, and the token lifetime logic
 * that reads and refreshes it.
 *
 * The record key follows the credential grammar `<scope>/<id>`: the scope is
 * this plugin's own name, the id names its one credential. Tokens refresh
 * inside `modifyRecord`, whose lock spans the network round trip, so two
 * processes can never rotate the same refresh token twice.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { CredentialKey } from "@deepseek-ai/dsh-credentials";
import { REFRESH_MARGIN_MS } from "../config";
import { jsonSafe } from "../json";
import type { OAuthServer } from "../oauth/server";

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
	/** Present only for a generation that issues one to public clients. */
	readonly clientSecret?: string;
	/** The exact redirect URI the client was registered with. */
	readonly redirectUri?: string;
	/** Base URL of the Atlassian site, learned from the account after connect. */
	readonly siteUrl?: string;
	readonly accessToken?: string;
	readonly refreshToken?: string;
	readonly tokenType?: string;
	readonly scope?: string;
	readonly expiresAt?: number;

	static readonly CREDENTIAL_KEY = "dsh-atlassian/mcp" as CredentialKey;

	constructor(params: Omit<Grant, "isSignedIn">) {
		this.version = params.version;
		this.issuer = params.issuer;
		this.resource = params.resource;
		this.clientId = params.clientId;
		this.clientSecret = params.clientSecret;
		this.redirectUri = params.redirectUri;
		this.siteUrl = params.siteUrl;
		this.accessToken = params.accessToken;
		this.refreshToken = params.refreshToken;
		this.tokenType = params.tokenType;
		this.scope = params.scope;
		this.expiresAt = params.expiresAt;
	}

	/** Whether a stored grant carries a usable access token. */
	isSignedIn(): this is SignedInGrant {
		return typeof this.accessToken === "string" && this.accessToken !== "";
	}

	/** Read the stored grant, or undefined when the user is signed out. */
	static async read(ctx: Context): Promise<Grant | undefined> {
		const record = await ctx.credentials.readRecord(Grant.CREDENTIAL_KEY);

		if (record === undefined || record.kind !== "grant") return undefined;

		return record.payload as Grant;
	}

	/**
	 * Read-decide-replace one grant under the credential store's cross-process lock.
	 * Returning `undefined` from `mutate` leaves the record untouched.
	 */
	static async mutate(
		ctx: Context,
		mutate: (current: Grant | undefined) => Promise<Grant | undefined>,
	): Promise<Grant | undefined> {
		const record = await ctx.credentials.modifyRecord(
			Grant.CREDENTIAL_KEY,
			async (current) => {
				const previous =
					current?.kind === "grant" ? (current.payload as Grant) : undefined;

				const next = await mutate(previous);
				if (next === undefined) return undefined;

				const payload = jsonSafe(next);
				if (payload === undefined) return undefined;

				return { kind: "grant", payload };
			},
		);

		return record?.kind === "grant" ? (record.payload as Grant) : undefined;
	}

	/** Forget the record entirely; the issuer is not told, matching the seam. */
	static async clear(ctx: Context): Promise<void> {
		await ctx.credentials.deleteRecord(Grant.CREDENTIAL_KEY);
	}

	/**
	 * Exchange the refresh token for a new access token, inside the store lock.
	 * A peer that refreshed while we waited makes this a no-op.
	 */
	static async refreshAccessToken(
		ctx: Context,
		oauth: OAuthServer,
	): Promise<string> {
		const after = await Grant.mutate(ctx, async (grant) => {
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

		if (!after.isSignedIn()) throw new Error("not signed in to Atlassian");

		return after.accessToken;
	}

	/** The token the MCP transport asks for before every request. */
	static async accessToken(
		ctx: Context,
		oauth: OAuthServer,
	): Promise<string | undefined> {
		const grant = await Grant.read(ctx);

		if (!grant?.isSignedIn()) return undefined;

		if (Date.now() < (grant.expiresAt ?? 0) - REFRESH_MARGIN_MS)
			return grant.accessToken;

		return await Grant.refreshAccessToken(ctx, oauth);
	}
}

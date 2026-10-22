/**
 * The authorization-code flow with PKCE, driven on the harness seam.
 *
 * The flow owns the whole conversation: it discovers the authorization server,
 * registers this installation as a client for the redirect URI it will actually
 * use, publishes the authorize URL, waits for the loopback callback, exchanges
 * the code, and commits the grant. Committing before `run` resolves is what the
 * seam requires.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { AuthorizationSession } from "@deepseek-ai/dsh-authorization";
import { SIGN_IN_TIMEOUT_MS } from "./config";
import { discover } from "./discovery";
import { Grant, type GrantStore } from "./grant";
import { jsonSafe } from "./json";
import { LoopbackListener } from "./loopback";
import type { OAuthProviderProfile } from "./provider";
import { authMethodOf, type RegisteredClient } from "./server";

export class AuthorizationFlow {
	/**
	 * @param profile - the provider account to sign in to.
	 * @param store - the record the finished grant is committed through.
	 */
	constructor(
		private readonly profile: OAuthProviderProfile,
		private readonly store: GrantStore,
	) {}

	/**
	 * Run one sign-in attempt to completion.
	 * @param _ctx - host context; the flow itself only touches the store.
	 * @param session - the seam's session: signals cancellation, publishes notices, commits.
	 */
	async run(_ctx: Context, session: AuthorizationSession): Promise<void> {
		const endpoint = this.profile.endpoint;
		const oauth = await discover(this.profile);

		const verifier = b64url(randomBytes(32));
		const expectedState = b64url(randomBytes(32));
		const challenge = b64url(createHash("sha256").update(verifier).digest());

		const listener = await LoopbackListener.listenForCode(
			this.profile.oauth.redirectPort,
			expectedState,
			this.profile.label,
		);

		const onAbort = (): void => listener.fail(new Error("sign-in cancelled"));
		session.signal.addEventListener("abort", onAbort, { once: true });

		let timer: ReturnType<typeof setTimeout> | undefined;

		try {
			const existing = await this.store.read();
			const client = await this.clientFor(
				oauth,
				listener.redirectUri,
				existing,
			);

			const authorize = new URL(oauth.authorizationEndpoint);

			for (const [key, value] of Object.entries({
				response_type: "code",
				client_id: client.clientId,
				redirect_uri: listener.redirectUri,
				scope: oauth.scopeString,
				state: expectedState,
				code_challenge: challenge,
				code_challenge_method: "S256",
				resource: endpoint,
			})) {
				authorize.searchParams.set(key, value);
			}

			session.notify({
				message: `Approve the ${this.profile.label} sign-in in your browser.`,
				url: authorize.href,
			});

			const authorizationCode = await new Promise<string>((resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("sign-in timed out")),
					SIGN_IN_TIMEOUT_MS,
				);

				listener.code.then(resolve, reject);
			});

			session.signal.throwIfAborted();

			const payload = await oauth.tokenRequest(client, {
				grant_type: "authorization_code",
				code: authorizationCode,
				redirect_uri: listener.redirectUri,
				code_verifier: verifier,
			});

			// A commit is what makes the seam call the attempt authorized. Without
			// an access token it would store a grant that can never connect.
			if (
				typeof payload.access_token !== "string" ||
				payload.access_token === ""
			)
				throw new Error("the token endpoint returned no access token");

			const base = {
				...(existing ?? { version: 1 as const }),
				version: 1 as const,
				issuer: oauth.issuer,
				resource: endpoint,
				redirectUri: listener.redirectUri,
				...client,
				scope: oauth.scopeString,
			};

			const payloadPair = jsonSafe({
				...base,
				...oauth.toTokenFields(payload, base),
			});

			if (payloadPair === undefined)
				throw new Error("the grant could not be represented as JSON");

			await session.commit({ kind: "grant", payload: payloadPair });
		} finally {
			clearTimeout(timer);

			session.signal.removeEventListener("abort", onAbort);
			await listener.close();
		}
	}

	/**
	 * The client to authorize with, registering one when the stored identity
	 * cannot be reused.
	 *
	 * A registration is bound to the exact redirect URIs it was issued for, and
	 * the loopback port is not guaranteed to be free, so a stored client is
	 * reused only when the resource and the URI both still match.
	 */
	private async clientFor(
		oauth: Awaited<ReturnType<typeof discover>>,
		redirectUri: string,
		existing: Grant | undefined,
	): Promise<RegisteredClient> {
		if (
			existing !== undefined &&
			existing.issuer === oauth.issuer &&
			existing.resource === this.profile.endpoint &&
			existing.redirectUri === redirectUri &&
			typeof existing.clientId === "string"
		) {
			const tokenAuthMethod = authMethodOf(existing);

			return existing.clientSecret === undefined
				? { clientId: existing.clientId, tokenAuthMethod }
				: {
						clientId: existing.clientId,
						clientSecret: existing.clientSecret,
						tokenAuthMethod,
					};
		}

		const registered = await oauth.registerClient(
			redirectUri,
			this.profile.oauth.clientName,
		);

		await this.store.mutate(
			async (grant) =>
				new Grant({
					...(grant ?? { version: 1 as const }),
					version: 1,
					issuer: oauth.issuer,
					resource: this.profile.endpoint,
					redirectUri,
					...registered,
				}),
		);

		return registered;
	}
}

/** base64url without padding, as PKCE and `state` require. */
function b64url(input: Buffer): string {
	return input
		.toString("base64")
		.replace(/\+/gu, "-")
		.replace(/\//gu, "_")
		.replace(/=+$/u, "");
}

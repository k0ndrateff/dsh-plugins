/**
 * The authorization-code flow with PKCE, registered on the harness
 * authorization seam.
 *
 * The flow owns the whole conversation with Atlassian: it discovers the
 * authorization server, registers this installation as a public client for the
 * redirect URI it will actually use, publishes the authorize URL as a notice,
 * waits for the loopback callback, exchanges the code, and commits the grant.
 * Committing before `run` resolves is what the seam requires.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { AuthorizationSession } from "@deepseek-ai/dsh-authorization";
import type { Config } from "../config";
import { SIGN_IN_TIMEOUT_MS } from "../config";
import { jsonSafe } from "../json";
import { Grant } from "../store/grant";
import { oauthDiscovery } from "./discovery";
import { LoopbackListener } from "./loopback";

class OAuthFlow {
	/** How the plugin identifies itself to Atlassian's consent screen. */
	private readonly CLIENT_NAME = "DeepSeek Harness";

	/**
	 * Run one sign-in attempt to completion.
	 * @param ctx - host context carrying the credential store.
	 * @param session - the seam's session: signals cancellation, publishes notices, commits.
	 * @param config - resolved plugin configuration.
	 */
	run = async (
		ctx: Context,
		session: AuthorizationSession,
		config: Config,
	): Promise<void> => {
		const endpoint = config.endpoint;
		const oauth = await oauthDiscovery.discover(endpoint);

		const verifier = this.b64url(randomBytes(32));
		const expectedState = this.b64url(randomBytes(32));
		const challenge = this.b64url(
			createHash("sha256").update(verifier).digest(),
		);

		const listener = await LoopbackListener.listenForCode(
			config.redirectPort,
			expectedState,
		);

		const onAbort = (): void => listener.fail(new Error("sign-in cancelled"));
		session.signal.addEventListener("abort", onAbort, { once: true });

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const existing = await Grant.read(ctx);
			// A registration is bound to the exact redirect URIs it was issued for, and
			// the loopback port is not guaranteed to be free, so reuse it only when the
			// resource and the URI both still match.
			const reusableClientId =
				existing !== undefined &&
				existing.resource === endpoint &&
				existing.redirectUri === listener.redirectUri
					? existing.clientId
					: undefined;

			let clientId: string;
			let clientSecret: string | undefined;

			if (typeof reusableClientId === "string") {
				clientId = reusableClientId;
				clientSecret = existing?.clientSecret;
			} else {
				const registered = await oauth.registerClient(
					listener.redirectUri,
					this.CLIENT_NAME,
				);

				clientId = registered.clientId;
				clientSecret = registered.clientSecret;

				await Grant.mutate(
					ctx,
					async (grant) =>
						new Grant({
							...(grant ?? { version: 1 as const }),
							version: 1,
							issuer: oauth.issuer,
							resource: endpoint,
							redirectUri: listener.redirectUri,
							clientId,
							...(clientSecret === undefined ? {} : { clientSecret }),
						}),
				);
			}

			const authorize = new URL(oauth.authorizationEndpoint);

			for (const [key, value] of Object.entries({
				response_type: "code",
				client_id: clientId,
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
				message: "Approve the Atlassian sign-in in your browser.",
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

			const payload = await oauth.tokenRequest(
				clientSecret === undefined ? { clientId } : { clientId, clientSecret },
				{
					grant_type: "authorization_code",
					code: authorizationCode,
					redirect_uri: listener.redirectUri,
					code_verifier: verifier,
				},
			);

			const base = {
				...(existing ?? { version: 1 as const }),
				version: 1 as const,
				issuer: oauth.issuer,
				resource: endpoint,
				redirectUri: listener.redirectUri,
				clientId,
				...(clientSecret === undefined ? {} : { clientSecret }),
				scope: oauth.scopeString,
			};

			// The store refuses a value JSON cannot represent; a token response may omit
			// fields the previous grant already carried, which is exactly where
			// `undefined` would otherwise leak in.
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
	};

	/** base64url without padding, as PKCE and `state` require. */
	private b64url = (input: Buffer): string => {
		return input
			.toString("base64")
			.replace(/\+/gu, "-")
			.replace(/\//gu, "_")
			.replace(/=+$/u, "");
	};
}

export const oauthFlow = new OAuthFlow();

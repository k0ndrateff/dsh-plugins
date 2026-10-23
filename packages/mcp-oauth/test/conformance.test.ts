/**
 * Conformance against real authorization servers.
 *
 * Discovery is read-only. Registration is not: a server that offers dynamic
 * client registration gets one throwaway client per run, because a registration
 * endpoint can only be verified by registering with it. The run then probes the
 * token endpoint with a code no server issued and reads the error — a client
 * the server refused answers `invalid_client`, one it accepted answers
 * `invalid_grant` — which is what makes the confidential path checkable without
 * a human at a consent screen.
 *
 * The expectations below are recorded facts, not wishes: what each server was
 * seen doing when this file was last written. A mismatch means either a
 * provider changed or the library regressed, and the label says which check
 * disagreed, so the fact can be re-recorded rather than guessed at.
 *
 *   bun run test/conformance.ts
 */

import { expect, test } from "bun:test";
import {
	DEFAULT_INSTANCE,
	discover,
	errorText,
	type OAuthProviderProfile,
	type OAuthServer,
	type RegisteredClient,
	type TokenAuthMethod,
} from "../src/index";

/** The redirect URI every registration here is bound to. */
const REDIRECT_URI = "http://127.0.0.1:8143/callback";

/**
 * Whether a registration was refused for asking too often.
 *
 * Registration creates a real OAuth application on the provider, and providers
 * limit how many one address may create in an hour — GitLab allows ten. A run
 * that arrives after the limit is spent has learned nothing about the library,
 * so it reports the provider as skipped rather than as broken.
 */
const rateLimited = (reason: string): boolean =>
	/\b429\b|rate limit|temporarily_unavailable/iu.test(reason);

/** The name a consent screen shows for a conformance client. */
const CLIENT_NAME = "DeepSeek Harness conformance";

/** How many times a just-registered client is asked for before it is called refused. */
const PROPAGATION_ATTEMPTS = 4;

/** How long to wait between those asks. */
const PROPAGATION_WAIT_MS = 2_000;

/** Wait without holding the process open. */
const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/** One endpoint under test and what it was recorded doing. */
interface Provider {
	readonly name: string;
	readonly profile: OAuthProviderProfile;
	/** Whether the server was recorded accepting an anonymous registration. */
	readonly registration: "open" | "closed";
	/** The client authentication a successful registration was recorded issuing. */
	readonly issued?: TokenAuthMethod;
	/** Whether the server was recorded handing a secret to that client anyway. */
	readonly issuedSecret?: boolean;
	/** Whether this server was recorded handing a secret to a client that asks. */
	readonly confidential?: boolean;
}

/** A profile with only the facts discovery and registration read. */
function profile(
	scope: string,
	endpoint: string,
	scopes: string[],
	fallbackScopes: string[] = [],
): OAuthProviderProfile {
	return {
		scope,
		label: scope,
		instance: DEFAULT_INSTANCE,
		endpoint,
		toolNamespace: scope,
		debug: false,
		oauth: {
			redirectPort: 8143,
			scopes,
			fallbackScopes,
			clientName: CLIENT_NAME,
		},
	};
}

const ATLASSIAN_CLASSIC = [
	"offline_access",
	"read:jira-work",
	"write:jira-work",
	"read:jira-user",
];

const PROVIDERS: Provider[] = [
	{
		name: "Atlassian v1",
		registration: "open",
		issued: "none",
		issuedSecret: false,
		confidential: true,
		profile: profile(
			"atlassian-v1",
			"https://mcp.atlassian.com/v1/mcp",
			[...ATLASSIAN_CLASSIC, "read:jira:agent-interface"],
			ATLASSIAN_CLASSIC,
		),
	},
	{
		// This generation hands a secret to a public client anyway, and says so
		// in the registration response; the library keeps it and still
		// authenticates as `none`, which is what the token endpoint accepts.
		name: "Atlassian v2",
		registration: "open",
		issued: "none",
		issuedSecret: true,
		profile: profile(
			"atlassian-v2",
			"https://mcp.atlassian.com/v2/mcp",
			["offline_access", "read:jira:agent-interface", "read:jira-work"],
			ATLASSIAN_CLASSIC,
		),
	},
	{
		name: "Sentry",
		registration: "open",
		issued: "none",
		issuedSecret: false,
		profile: profile("sentry", "https://mcp.sentry.dev/mcp", [
			"org:read",
			"project:write",
		]),
	},
	{
		// GitLab advertises only confidential methods, and its registration
		// endpoint hands back a public client anyway: the response is the fact.
		name: "GitLab",
		registration: "open",
		issued: "none",
		issuedSecret: false,
		profile: profile("gitlab", "https://gitlab.com/api/v4/mcp", ["mcp"]),
	},
	{
		// Figma advertises a registration endpoint and refuses anonymous calls
		// to it, so its clients have to come from somewhere else.
		name: "Figma",
		registration: "closed",
		profile: profile("figma", "https://mcp.figma.com/mcp", ["mcp:connect"]),
	},
];

/** The body of a token request whose code no server ever issued. */
const probe = (): Record<string, string> => ({
	grant_type: "authorization_code",
	code: "conformance-not-a-code",
	redirect_uri: REDIRECT_URI,
	code_verifier: "x".repeat(43),
});

/**
 * The OAuth error a token request answered with.
 * @returns the error code, or undefined when the request unexpectedly succeeded.
 */
async function tokenError(
	oauth: OAuthServer,
	client: Pick<
		RegisteredClient,
		"clientId" | "clientSecret" | "tokenAuthMethod"
	>,
): Promise<string | undefined> {
	try {
		await oauth.tokenRequest(client, probe());

		return undefined;
	} catch (error) {
		const message = errorText(error);

		return message.match(/"error"\s*:\s*"([a-z_]+)"/u)?.[1] ?? message;
	}
}

/**
 * Whether the token endpoint accepted the registered client.
 *
 * A server that refuses a client it does not know answers `invalid_client`, so
 * running the same probe with an impossible client id says whether the answer
 * for the registered one means anything. A server that validates the grant
 * first — Atlassian's second generation does — answers the same way for both,
 * and then the authorize endpoint is what proves the client is usable.
 *
 * A server that does refuse the unknown client can also refuse a client it has
 * just registered: token endpoints do not always know about a registration the
 * moment they answered it. That is indistinguishable from a real refusal except
 * by asking again a little later, so this waits before it concludes.
 */
async function checkClientAccepted(
	oauth: OAuthServer,
	client: Pick<
		RegisteredClient,
		"clientId" | "clientSecret" | "tokenAuthMethod"
	>,
	label = "the registered client is accepted at the token endpoint",
): Promise<void> {
	const unknown = await tokenError(oauth, {
		...client,
		clientId: "conformance-unknown-client",
	});
	let accepted = await tokenError(oauth, client);

	if (unknown !== "invalid_client") {
		expect(
			accepted === unknown,
			`the token endpoint validates the grant before the client, as recorded — ${`registered: ${String(accepted)}, unknown: ${String(unknown)}`}`,
		).toBe(true);

		return;
	}

	for (
		let attempt = 1;
		attempt < PROPAGATION_ATTEMPTS && accepted === "invalid_client";
		attempt += 1
	) {
		await wait(PROPAGATION_WAIT_MS);
		accepted = await tokenError(oauth, client);
	}

	expect(
		accepted !== "invalid_client",
		String(label) + " — " + String(accepted),
	).toBe(true);
}

/** Register a client asking for one method, whatever the server prefers. */
async function registerConfidential(
	oauth: OAuthServer,
	method: TokenAuthMethod,
): Promise<RegisteredClient> {
	if (oauth.registrationEndpoint === undefined)
		throw new Error(`${oauth.issuer} offers no registration`);

	const response = await fetch(oauth.registrationEndpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify({
			client_name: CLIENT_NAME,
			redirect_uris: [REDIRECT_URI],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: method,
			scope: oauth.scopeString,
		}),
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await response.json()) as Record<string, unknown>;

	if (!response.ok)
		throw new Error(`${method} registration failed (${response.status})`);

	const clientId = body.client_id;
	const clientSecret = body.client_secret;

	if (typeof clientId !== "string" || typeof clientSecret !== "string")
		throw new Error(`${method} registration issued no secret`);

	return { clientId, clientSecret, tokenAuthMethod: method };
}

/** The confidential half: a secret from registration, used and misused. */
async function conformConfidential(oauth: OAuthServer): Promise<void> {
	for (const method of [
		"client_secret_post",
		"client_secret_basic",
	] as TokenAuthMethod[]) {
		try {
			const client = await registerConfidential(oauth, method);

			await checkClientAccepted(
				oauth,
				client,
				`a ${method} client authenticates with the secret from registration`,
			);

			const refused = await tokenError(oauth, {
				...client,
				clientSecret: "not-the-secret",
			});

			expect(
				refused === "invalid_client",
				String(`a wrong ${method} secret is refused as a client error`) +
					" — " +
					String(refused),
			).toBe(true);
		} catch (error) {
			const reason = errorText(error);

			if (rateLimited(reason)) {
				console.log(`  --   ${method} registration is rate-limited; skipped`);

				continue;
			}

			expect(
				false,
				String(`${method} registration issued a secret`) + " — " + reason,
			).toBe(true);
		}
	}
}

/** The authorize URL a real sign-in would open, to see the server accept it. */
async function conformAuthorize(
	oauth: OAuthServer,
	client: RegisteredClient,
): Promise<void> {
	const authorize = new URL(oauth.authorizationEndpoint);

	for (const [key, value] of Object.entries({
		response_type: "code",
		client_id: client.clientId,
		redirect_uri: REDIRECT_URI,
		scope: oauth.scopeString,
		state: "conformance",
		code_challenge: "x".repeat(43),
		code_challenge_method: "S256",
		resource: oauth.resource,
	}))
		authorize.searchParams.set(key, value);

	try {
		const page = await fetch(authorize, {
			redirect: "manual",
			signal: AbortSignal.timeout(30_000),
		});

		expect(
			page.status < 400,
			`the authorize endpoint accepts the registered client — ${`HTTP ${page.status}`}`,
		).toBe(true);
	} catch (error) {
		expect(
			false,
			`the authorize endpoint accepts the registered client — ${errorText(error)}`,
		).toBe(true);
	}
}

async function conform(provider: Provider): Promise<void> {
	let oauth: OAuthServer;

	try {
		oauth = await discover(provider.profile);
	} catch (error) {
		expect(false, `discovery succeeded — ${errorText(error)}`).toBe(true);

		return;
	}

	expect(oauth.issuer !== "", `issuer resolved — ${oauth.issuer}`).toBe(true);
	expect(
		oauth.authorizationEndpoint.startsWith("https://"),
		`authorization endpoint is absolute — ${oauth.authorizationEndpoint}`,
	).toBe(true);
	expect(
		oauth.tokenEndpoint.startsWith("https://"),
		`token endpoint is absolute — ${oauth.tokenEndpoint}`,
	).toBe(true);
	expect(
		oauth.resource === provider.profile.endpoint,
		`the resource is the one asked for — ${oauth.resource}`,
	).toBe(true);
	expect(
		oauth.scopes.length > 0 &&
			oauth.scopes.every((scope) =>
				provider.profile.oauth.scopes.includes(scope),
			),
		`the scopes are the provider's, narrowed to what was advertised — ${oauth.scopes.join(" ")}`,
	).toBe(true);
	expect(
		typeof oauth.registrationEndpoint === "string",
		`dynamic client registration is advertised — ${String(oauth.registrationEndpoint)}`,
	).toBe(true);

	if (provider.registration === "closed") {
		let refusal = "";

		try {
			await oauth.registerClient(REDIRECT_URI, CLIENT_NAME);
		} catch (error) {
			refusal = errorText(error);
		}

		expect(
			/failed \((401|403)\)/u.test(refusal),
			`registration is refused, as recorded — ${refusal === "" ? "registration unexpectedly succeeded" : refusal}`,
		).toBe(true);

		return;
	}

	let client: RegisteredClient;

	try {
		client = await oauth.registerClient(REDIRECT_URI, CLIENT_NAME);
	} catch (error) {
		const reason = errorText(error);

		if (rateLimited(reason)) {
			console.log(
				`  --   registration is rate-limited right now; the rest of ${provider.name} is skipped — ${reason}`,
			);

			return;
		}

		expect(false, `registration issued a client — ${reason}`).toBe(true);

		return;
	}

	expect(
		client.clientId !== "",
		`registration issued a client id — ${client.clientId}`,
	).toBe(true);
	expect(
		client.tokenAuthMethod === provider.issued,
		`the issued client authentication is the one recorded — ${`${client.tokenAuthMethod}, recorded ${String(provider.issued)}`}`,
	).toBe(true);
	expect(
		(client.clientSecret !== undefined) === (provider.issuedSecret === true),
		`whether a secret came with it is the one recorded — ${client.clientSecret === undefined ? "no secret" : "a secret"}`,
	).toBe(true);

	await checkClientAccepted(
		oauth,
		client,
		"the registered client authenticates at the token endpoint",
	);
	await conformAuthorize(oauth, client);

	if (provider.confidential === true) await conformConfidential(oauth);
}

const run = process.env.MCP_OAUTH_LIVE === "1" ? test : test.skip;

run(
	"conformance against real authorization servers",
	async () => {
		for (const provider of PROVIDERS) {
			console.log(`\n=== ${provider.name} ===`);

			await conform(provider);
		}
	},
	300_000,
);

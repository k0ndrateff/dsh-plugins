/**
 * Offline checks for the library's pure decisions.
 *
 * Everything here is a function of its arguments: the account grammar, the
 * client-authentication policy, and the merge of a token response into a grant.
 * The live half — discovery, registration, and the token endpoint — is
 * `conformance.ts`, which needs the network.
 *
 *   bun run test/unit.ts
 */

import { expect, test } from "bun:test";
import { parseCredentialKey } from "@deepseek-ai/dsh-credentials";
import {
	credentialKeyFor,
	DEFAULT_INSTANCE,
	instanceOfKey,
	instancesOf,
} from "../src/account";
import { Grant } from "../src/grant";
import { jsonSafe } from "../src/json";
import { mcpJson } from "../src/payload";
import {
	accountLabel,
	credentialKeyOf,
	type NoAuthProviderProfile,
	needsOAuth,
	type OAuthProviderProfile,
	type ProviderProfile,
} from "../src/provider";
import {
	authMethodOf,
	chooseTokenAuthMethod,
	OAuthServer,
} from "../src/server";

/** The facts every profile carries, whatever its server needs. */
function base(scope: string, instance: string): ProviderProfile {
	return {
		scope,
		label: scope,
		instance,
		endpoint: `https://${scope}.example/mcp`,
		toolNamespace: scope,
		debug: false,
	};
}

/** An account whose server is reached through OAuth. */
function profile(
	scope: string,
	instance = DEFAULT_INSTANCE,
): OAuthProviderProfile {
	return {
		...base(scope, instance),
		oauth: {
			redirectPort: 8143,
			scopes: ["mcp"],
			fallbackScopes: ["mcp"],
			clientName: "DeepSeek Harness",
		},
	};
}

/** An account whose server is local and needs no credentials. */
function local(scope: string): NoAuthProviderProfile {
	return {
		scope,
		label: scope,
		instance: DEFAULT_INSTANCE,
		endpoint: `https://${scope}.example/mcp`,
		toolNamespace: scope,
		debug: false,
	};
}

test("accounts", async () => {
	expect(
		credentialKeyFor("dsh-atlassian") === "dsh-atlassian/mcp",
		`the default account keeps the record id it has always had — ${credentialKeyFor("dsh-atlassian")}`,
	).toBe(true);
	expect(
		credentialKeyFor("dsh-gitlab", "work") === "dsh-gitlab/mcp-work",
		`a named account gets its own record — ${credentialKeyFor("dsh-gitlab", "work")}`,
	).toBe(true);
	expect(
		credentialKeyFor("dsh-gitlab", DEFAULT_INSTANCE) ===
			credentialKeyFor("dsh-gitlab"),
		"an explicit default account is the same record as an omitted one",
	).toBe(true);
	expect(
		instanceOfKey(
			"dsh-gitlab",
			credentialKeyFor("dsh-gitlab", "side-project"),
		) === "side-project",
		"a hyphenated account name round-trips",
	).toBe(true);
	expect(
		instanceOfKey("dsh-gitlab", credentialKeyFor("dsh-gitlab", "mcp")) ===
			"mcp",
		"an account may be called mcp",
	).toBe(true);
	expect(
		instanceOfKey("dsh-gitlab", "dsh-gitlab/mcp") === DEFAULT_INSTANCE,
		"the default record reads back as the default account",
	).toBe(true);
	expect(
		instanceOfKey("dsh-gitlab", "dsh-sentry/mcp") === undefined,
		"another plugin's record is not this plugin's account",
	).toBe(true);
	expect(
		instanceOfKey("dsh-gitlab", "dsh-gitlab/whatever") === undefined,
		"an id this plugin never wrote names no account",
	).toBe(true);

	let rejected = "";
	try {
		credentialKeyFor("dsh-gitlab", "Work");
	} catch (error) {
		rejected = error instanceof Error ? error.message : String(error);
	}
	expect(
		rejected !== "",
		"an account name outside the key grammar is refused",
	).toBe(true);

	let rejectedScope = "";
	try {
		credentialKeyFor("DSH-GitLab");
	} catch (error) {
		rejectedScope = error instanceof Error ? error.message : String(error);
	}
	expect(
		rejectedScope !== "",
		`a scope outside the key grammar is refused too — ${rejectedScope}`,
	).toBe(true);

	const records = [
		{ key: parseCredentialKey("dsh-sentry/mcp"), kind: "grant" as const },
		{ key: parseCredentialKey("dsh-gitlab/mcp"), kind: "grant" as const },
		{
			key: parseCredentialKey(credentialKeyFor("dsh-gitlab", "work")),
			kind: "grant" as const,
		},
		{
			key: parseCredentialKey(credentialKeyFor("dsh-gitlab", "work")),
			kind: "grant" as const,
		},
		{ key: parseCredentialKey("dsh-gitlab/foreign"), kind: "grant" as const },
	];
	expect(
		JSON.stringify(instancesOf("dsh-gitlab", records)) ===
			JSON.stringify([DEFAULT_INSTANCE, "work"]),
		`listing accounts keeps the store's order and drops what is not an account — ${JSON.stringify(instancesOf("dsh-gitlab", records))}`,
	).toBe(true);
	expect(
		instancesOf("dsh-figma", records).length === 0,
		"a plugin with no records has no accounts",
	).toBe(true);

	expect(
		credentialKeyOf(profile("dsh-gitlab", "work")) === "dsh-gitlab/mcp-work",
		"the record key comes from the profile",
	).toBe(true);
	expect(
		accountLabel(profile("dsh-atlassian")) === "dsh-atlassian",
		"a default account logs under the plugin name",
	).toBe(true);
	expect(
		accountLabel(profile("dsh-gitlab", "work")) === "dsh-gitlab/work",
		"a named account logs under its own name",
	).toBe(true);
	expect(
		needsOAuth(profile("dsh-gitlab")),
		"an OAuth profile is recognized",
	).toBe(true);
	expect(
		!needsOAuth(local("figma-local")),
		"a profile without OAuth facts is a no-auth server",
	).toBe(true);
});
test("client authentication", async () => {
	expect(
		chooseTokenAuthMethod([
			"client_secret_basic",
			"client_secret_post",
			"none",
		]) === "none",
		"a public client is preferred when the server allows one",
	).toBe(true);
	expect(
		chooseTokenAuthMethod(["client_secret_basic", "client_secret_post"]) ===
			"client_secret_post",
		"a server without `none` gets a secret in the body",
	).toBe(true);
	expect(
		chooseTokenAuthMethod(["client_secret_basic"]) === "client_secret_basic",
		"a server that only understands basic gets basic",
	).toBe(true);
	expect(
		chooseTokenAuthMethod(undefined) === "none",
		"a silent server is asked for a public client",
	).toBe(true);
	expect(
		chooseTokenAuthMethod(["private_key_jwt"]) === "none",
		"a server advertising nothing we know still gets a registration attempt",
	).toBe(true);

	expect(
		authMethodOf({}) === "none",
		"a stored grant without a method and without a secret is public",
	).toBe(true);
	expect(
		authMethodOf({ clientSecret: "s" }) === "client_secret_post",
		"a stored grant with a secret predates the field and posts it",
	).toBe(true);
	expect(
		authMethodOf({ clientSecret: "s", tokenAuthMethod: "none" }) === "none",
		"an explicit method wins over the presence of a secret",
	).toBe(true);
});
test("reading a tool result", async () => {
	expect(
		mcpJson({ content: [{ type: "text", text: '{"a":1}' }] }).length === 1,
		"the JSON inside a text block is read",
	).toBe(true);
	expect(
		(
			mcpJson({
				content: [{ type: "text", text: "prose" }],
				structuredContent: { a: 1 },
			}).at(0) as { a?: number } | undefined
		)?.a === 1,
		"structuredContent is read even when no block carries it",
	).toBe(true);
	expect(
		(
			mcpJson({
				content: [{ type: "text", text: '{"from":"text"}' }],
				structuredContent: { from: "structured" },
			})[0] as { from?: string } | undefined
		)?.from === "structured",
		"structuredContent comes before the text that renders it",
	).toBe(true);
	expect(
		mcpJson({ content: [{ type: "text", text: "# Heading\n\nprose" }] })
			.length === 0 && mcpJson(undefined).length === 0,
		"prose alone yields nothing to walk",
	).toBe(true);
});
test("the stored grant", async () => {
	const rehydrated = Grant.from({
		version: 1,
		clientId: "client",
		clientSecret: "secret",
		tokenAuthMethod: "client_secret_basic",
		accessToken: "token",
	});

	expect(
		rehydrated?.tokenAuthMethod === "client_secret_basic",
		"a grant keeps the client authentication it was stored with",
	).toBe(true);

	const oauth = new OAuthServer({
		issuer: "https://example.test",
		resource: "https://example.test/mcp",
		authorizationEndpoint: "https://example.test/authorize",
		tokenEndpoint: "https://example.test/token",
		scopes: ["mcp"],
		scopeString: "mcp",
		tokenAuthMethod: "none",
	});

	const refreshed = oauth.toTokenFields(
		{ access_token: "next", expires_in: 120 },
		{ refreshToken: "kept", tokenType: "Bearer", scope: "mcp" },
	);

	expect(
		refreshed.accessToken === "next",
		"a new access token replaces the old one",
	).toBe(true);
	expect(
		refreshed.refreshToken === "kept",
		"a refresh token the response omits is kept",
	).toBe(true);
	expect(
		refreshed.scope === "mcp",
		"the response's scope is kept when it names none",
	).toBe(true);
	expect(
		(refreshed.expiresAt ?? 0) > Date.now() + 60_000,
		"expiry comes from the response",
	).toBe(true);
	expect(
		oauth.toTokenFields({ access_token: "x" }, {}).expiresAt !== undefined,
		"a response without a lifetime still expires",
	).toBe(true);
	expect(
		oauth.toTokenFields({ access_token: "" }, { accessToken: "kept" })
			.accessToken === "kept",
		"an empty access token does not erase the working one",
	).toBe(true);
	expect(
		oauth.toTokenFields({ refresh_token: "" }, { refreshToken: "kept" })
			.refreshToken === "kept",
		"an empty refresh token does not erase the working one",
	).toBe(true);

	const carried = jsonSafe({ keep: 1, drop: undefined }) as Record<
		string,
		unknown
	>;

	expect(
		carried.keep === 1 && !("drop" in carried),
		`a payload JSON cannot carry is refused by the store — ${JSON.stringify(carried)}`,
	).toBe(true);
});

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

import { test } from "bun:test";
import { parseCredentialKey } from "@deepseek-ai/dsh-credentials";
import { check } from "../../../test/support";
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
	check(
		"the default account keeps the record id it has always had",
		credentialKeyFor("dsh-atlassian") === "dsh-atlassian/mcp",
		credentialKeyFor("dsh-atlassian"),
	);
	check(
		"a named account gets its own record",
		credentialKeyFor("dsh-gitlab", "work") === "dsh-gitlab/mcp-work",
		credentialKeyFor("dsh-gitlab", "work"),
	);
	check(
		"an explicit default account is the same record as an omitted one",
		credentialKeyFor("dsh-gitlab", DEFAULT_INSTANCE) ===
			credentialKeyFor("dsh-gitlab"),
	);
	check(
		"a hyphenated account name round-trips",
		instanceOfKey(
			"dsh-gitlab",
			credentialKeyFor("dsh-gitlab", "side-project"),
		) === "side-project",
	);
	check(
		"an account may be called mcp",
		instanceOfKey("dsh-gitlab", credentialKeyFor("dsh-gitlab", "mcp")) ===
			"mcp",
	);
	check(
		"the default record reads back as the default account",
		instanceOfKey("dsh-gitlab", "dsh-gitlab/mcp") === DEFAULT_INSTANCE,
	);
	check(
		"another plugin's record is not this plugin's account",
		instanceOfKey("dsh-gitlab", "dsh-sentry/mcp") === undefined,
	);
	check(
		"an id this plugin never wrote names no account",
		instanceOfKey("dsh-gitlab", "dsh-gitlab/whatever") === undefined,
	);

	let rejected = "";
	try {
		credentialKeyFor("dsh-gitlab", "Work");
	} catch (error) {
		rejected = error instanceof Error ? error.message : String(error);
	}
	check("an account name outside the key grammar is refused", rejected !== "");

	let rejectedScope = "";
	try {
		credentialKeyFor("DSH-GitLab");
	} catch (error) {
		rejectedScope = error instanceof Error ? error.message : String(error);
	}
	check(
		"a scope outside the key grammar is refused too",
		rejectedScope !== "",
		rejectedScope,
	);

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
	check(
		"listing accounts keeps the store's order and drops what is not an account",
		JSON.stringify(instancesOf("dsh-gitlab", records)) ===
			JSON.stringify([DEFAULT_INSTANCE, "work"]),
		JSON.stringify(instancesOf("dsh-gitlab", records)),
	);
	check(
		"a plugin with no records has no accounts",
		instancesOf("dsh-figma", records).length === 0,
	);

	check(
		"the record key comes from the profile",
		credentialKeyOf(profile("dsh-gitlab", "work")) === "dsh-gitlab/mcp-work",
	);
	check(
		"a default account logs under the plugin name",
		accountLabel(profile("dsh-atlassian")) === "dsh-atlassian",
	);
	check(
		"a named account logs under its own name",
		accountLabel(profile("dsh-gitlab", "work")) === "dsh-gitlab/work",
	);
	check("an OAuth profile is recognized", needsOAuth(profile("dsh-gitlab")));
	check(
		"a profile without OAuth facts is a no-auth server",
		!needsOAuth(local("figma-local")),
	);
});
test("client authentication", async () => {
	check(
		"a public client is preferred when the server allows one",
		chooseTokenAuthMethod([
			"client_secret_basic",
			"client_secret_post",
			"none",
		]) === "none",
	);
	check(
		"a server without `none` gets a secret in the body",
		chooseTokenAuthMethod(["client_secret_basic", "client_secret_post"]) ===
			"client_secret_post",
	);
	check(
		"a server that only understands basic gets basic",
		chooseTokenAuthMethod(["client_secret_basic"]) === "client_secret_basic",
	);
	check(
		"a silent server is asked for a public client",
		chooseTokenAuthMethod(undefined) === "none",
	);
	check(
		"a server advertising nothing we know still gets a registration attempt",
		chooseTokenAuthMethod(["private_key_jwt"]) === "none",
	);

	check(
		"a stored grant without a method and without a secret is public",
		authMethodOf({}) === "none",
	);
	check(
		"a stored grant with a secret predates the field and posts it",
		authMethodOf({ clientSecret: "s" }) === "client_secret_post",
	);
	check(
		"an explicit method wins over the presence of a secret",
		authMethodOf({ clientSecret: "s", tokenAuthMethod: "none" }) === "none",
	);
});
test("reading a tool result", async () => {
	check(
		"the JSON inside a text block is read",
		mcpJson({ content: [{ type: "text", text: '{"a":1}' }] }).length === 1,
	);
	check(
		"structuredContent is read even when no block carries it",
		(
			mcpJson({
				content: [{ type: "text", text: "prose" }],
				structuredContent: { a: 1 },
			}).at(0) as { a?: number } | undefined
		)?.a === 1,
	);
	check(
		"structuredContent comes before the text that renders it",
		(
			mcpJson({
				content: [{ type: "text", text: '{"from":"text"}' }],
				structuredContent: { from: "structured" },
			})[0] as { from?: string } | undefined
		)?.from === "structured",
	);
	check(
		"prose alone yields nothing to walk",
		mcpJson({ content: [{ type: "text", text: "# Heading\n\nprose" }] })
			.length === 0 && mcpJson(undefined).length === 0,
	);
});
test("the stored grant", async () => {
	const rehydrated = Grant.from({
		version: 1,
		clientId: "client",
		clientSecret: "secret",
		tokenAuthMethod: "client_secret_basic",
		accessToken: "token",
	});

	check(
		"a grant keeps the client authentication it was stored with",
		rehydrated?.tokenAuthMethod === "client_secret_basic",
	);

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

	check(
		"a new access token replaces the old one",
		refreshed.accessToken === "next",
	);
	check(
		"a refresh token the response omits is kept",
		refreshed.refreshToken === "kept",
	);
	check(
		"the response's scope is kept when it names none",
		refreshed.scope === "mcp",
	);
	check(
		"expiry comes from the response",
		(refreshed.expiresAt ?? 0) > Date.now() + 60_000,
	);
	check(
		"a response without a lifetime still expires",
		oauth.toTokenFields({ access_token: "x" }, {}).expiresAt !== undefined,
	);
	check(
		"an empty access token does not erase the working one",
		oauth.toTokenFields({ access_token: "" }, { accessToken: "kept" })
			.accessToken === "kept",
	);
	check(
		"an empty refresh token does not erase the working one",
		oauth.toTokenFields({ refresh_token: "" }, { refreshToken: "kept" })
			.refreshToken === "kept",
	);

	const carried = jsonSafe({ keep: 1, drop: undefined }) as Record<
		string,
		unknown
	>;

	check(
		"a payload JSON cannot carry is refused by the store",
		carried.keep === 1 && !("drop" in carried),
		JSON.stringify(carried),
	);
});

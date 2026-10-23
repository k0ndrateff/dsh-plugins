/**
 * Offline checks for the Sentry host half.
 *
 * Everything here is a pure decision: how the profile patch is normalized, what
 * the provider profile ends up saying, and how the account's own organization
 * list is read. The live half — sign-in and the MCP tools — needs a browser and
 * an account, and is proved by the plugin running rather than by this file.
 *
 *   bun run test/dry-run.ts
 */

import { test } from "bun:test";
import { credentialKeyOf, DEFAULT_INSTANCE } from "dsh-mcp-oauth";
import { check } from "../../../test/support";
import {
	DEFAULT_ENDPOINT,
	DEFAULT_REDIRECT_PORT,
	resolveConfig,
	sentryProfile,
} from "../src/host/config";
import { OrganizationFacts } from "../src/host/store/organization";

test("the host against recorded answers", async () => {
	console.log("\n=== configuration ===");

	check(
		"an empty patch falls back to Sentry's own resource and port",
		resolveConfig(undefined).endpoint === DEFAULT_ENDPOINT &&
			resolveConfig(undefined).redirectPort === DEFAULT_REDIRECT_PORT,
		JSON.stringify(resolveConfig(undefined)),
	);
	check(
		"a malformed port falls back rather than failing activation",
		resolveConfig({ redirectPort: "eighty" }).redirectPort ===
			DEFAULT_REDIRECT_PORT &&
			resolveConfig({ redirectPort: -1 }).redirectPort ===
				DEFAULT_REDIRECT_PORT,
	);
	check(
		"a configured endpoint and port are kept",
		resolveConfig({
			endpoint: "https://sentry.example/mcp",
			redirectPort: 9000,
		}).endpoint === "https://sentry.example/mcp" &&
			resolveConfig({ redirectPort: 9000 }).redirectPort === 9000,
	);
	check("debug is off unless asked for", resolveConfig({}).debug === false);

	console.log("\n=== the provider profile ===");

	const profile = sentryProfile(resolveConfig(undefined));

	check(
		"the profile is the plugin's own account",
		profile.scope === "dsh-sentry" &&
			profile.instance === DEFAULT_INSTANCE &&
			profile.toolNamespace === "sentry",
		`${profile.scope}/${profile.instance}/${profile.toolNamespace}`,
	);
	check(
		"the credential record is the plugin's default account",
		credentialKeyOf(profile) === "dsh-sentry/mcp",
		credentialKeyOf(profile),
	);
	check(
		"the profile asks for Sentry's scopes, most wanted first",
		profile.oauth.scopes[0] === "org:read" &&
			profile.oauth.scopes.includes("event:write") &&
			profile.oauth.fallbackScopes.includes("org:read"),
		profile.oauth.scopes.join(" "),
	);
	check(
		"the resource is both the endpoint and the OAuth resource",
		profile.endpoint === DEFAULT_ENDPOINT,
		profile.endpoint,
	);

	console.log("\n=== the organization list ===");

	const listed = {
		organizations: [
			{
				slug: "acme",
				webUrl: "https://acme.sentry.io/",
				regionUrl: "https://us.sentry.io",
			},
			{ slug: "other", webUrl: null, regionUrl: null },
		],
		hasMore: false,
		nextCursor: null,
	};

	check(
		"the first organization of the account's list is read",
		OrganizationFacts.parse({
			content: [{ type: "text", text: JSON.stringify(listed) }],
		}).slug === "acme",
	);
	check(
		"its web URL is kept without the trailing slash",
		OrganizationFacts.parse({
			content: [{ type: "text", text: JSON.stringify(listed) }],
		}).webUrl === "https://acme.sentry.io",
	);
	check(
		"an answer that names no organization reads as empty",
		OrganizationFacts.parse({
			content: [{ type: "text", text: '{"organizations":[]}' }],
		}).isEmpty &&
			OrganizationFacts.parse(undefined).isEmpty &&
			OrganizationFacts.parse({
				content: [{ type: "text", text: "no json here" }],
			}).isEmpty,
	);
	check(
		"what the stored grant already knows is restored",
		OrganizationFacts.from({
			version: 1,
			extra: {
				organization: "acme",
				organizationUrl: "https://acme.sentry.io",
			},
		} as never).slug === "acme",
	);
});

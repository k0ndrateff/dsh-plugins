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

import { expect, test } from "bun:test";
import { credentialKeyOf, DEFAULT_INSTANCE } from "dsh-mcp-oauth";
import {
	DEFAULT_ENDPOINT,
	DEFAULT_REDIRECT_PORT,
	resolveConfig,
	sentryProfile,
} from "../src/host/config";
import { OrganizationFacts } from "../src/host/store/organization";

test("the host against recorded answers", async () => {
	console.log("\n=== configuration ===");

	expect(
		resolveConfig(undefined).endpoint === DEFAULT_ENDPOINT &&
			resolveConfig(undefined).redirectPort === DEFAULT_REDIRECT_PORT,
		`an empty patch falls back to Sentry's own resource and port — ${JSON.stringify(resolveConfig(undefined))}`,
	).toBe(true);
	expect(
		resolveConfig({ redirectPort: "eighty" }).redirectPort ===
			DEFAULT_REDIRECT_PORT &&
			resolveConfig({ redirectPort: -1 }).redirectPort ===
				DEFAULT_REDIRECT_PORT,
		"a malformed port falls back rather than failing activation",
	).toBe(true);
	expect(
		resolveConfig({
			endpoint: "https://sentry.example/mcp",
			redirectPort: 9000,
		}).endpoint === "https://sentry.example/mcp" &&
			resolveConfig({ redirectPort: 9000 }).redirectPort === 9000,
		"a configured endpoint and port are kept",
	).toBe(true);
	expect(
		resolveConfig({}).debug === false,
		"debug is off unless asked for",
	).toBe(true);

	console.log("\n=== the provider profile ===");

	const profile = sentryProfile(resolveConfig(undefined));

	expect(
		profile.scope === "dsh-sentry" &&
			profile.instance === DEFAULT_INSTANCE &&
			profile.toolNamespace === "sentry",
		`the profile is the plugin's own account — ${`${profile.scope}/${profile.instance}/${profile.toolNamespace}`}`,
	).toBe(true);
	expect(
		credentialKeyOf(profile) === "dsh-sentry/mcp",
		`the credential record is the plugin's default account — ${credentialKeyOf(profile)}`,
	).toBe(true);
	expect(
		profile.oauth.scopes[0] === "org:read" &&
			profile.oauth.scopes.includes("event:write") &&
			profile.oauth.fallbackScopes.includes("org:read"),
		`the profile asks for Sentry's scopes, most wanted first — ${profile.oauth.scopes.join(" ")}`,
	).toBe(true);
	expect(
		profile.endpoint === DEFAULT_ENDPOINT,
		`the resource is both the endpoint and the OAuth resource — ${profile.endpoint}`,
	).toBe(true);

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

	expect(
		OrganizationFacts.parse({
			content: [{ type: "text", text: JSON.stringify(listed) }],
		}).slug === "acme",
		"the first organization of the account's list is read",
	).toBe(true);
	expect(
		OrganizationFacts.parse({
			content: [{ type: "text", text: JSON.stringify(listed) }],
		}).webUrl === "https://acme.sentry.io",
		"its web URL is kept without the trailing slash",
	).toBe(true);
	expect(
		OrganizationFacts.parse({
			content: [{ type: "text", text: '{"organizations":[]}' }],
		}).isEmpty &&
			OrganizationFacts.parse(undefined).isEmpty &&
			OrganizationFacts.parse({
				content: [{ type: "text", text: "no json here" }],
			}).isEmpty,
		"an answer that names no organization reads as empty",
	).toBe(true);
	expect(
		OrganizationFacts.from({
			version: 1,
			extra: {
				organization: "acme",
				organizationUrl: "https://acme.sentry.io",
			},
		} as never).slug === "acme",
		"what the stored grant already knows is restored",
	).toBe(true);
});

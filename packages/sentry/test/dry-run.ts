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

import { credentialKeyOf, DEFAULT_INSTANCE } from "dsh-mcp-oauth";
import {
	DEFAULT_ENDPOINT,
	DEFAULT_REDIRECT_PORT,
	resolveConfig,
	sentryProfile,
} from "../src/host/config";
import { OrganizationFacts } from "../src/host/store/organization";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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
		resolveConfig({ redirectPort: -1 }).redirectPort === DEFAULT_REDIRECT_PORT,
);
check(
	"a configured endpoint and port are kept",
	resolveConfig({ endpoint: "https://sentry.example/mcp", redirectPort: 9000 })
		.endpoint === "https://sentry.example/mcp" &&
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
		extra: { organization: "acme", organizationUrl: "https://acme.sentry.io" },
	} as never).slug === "acme",
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

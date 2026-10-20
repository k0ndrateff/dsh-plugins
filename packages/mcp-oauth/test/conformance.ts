/**
 * Conformance run against real authorization servers.
 *
 * Discovery needs no credentials, so every provider on the roadmap is checked
 * here: the library is provider-agnostic only if it can resolve each one's
 * endpoints and pick a workable scope set. Nothing in this file registers a
 * client or completes a sign-in, so it is safe to run at any time.
 *
 *   bun run test/conformance.ts
 */

import { discover } from "../src/index";
import type { ProviderProfile } from "../src/provider";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** A profile with only the facts discovery reads. */
function profile(
	id: string,
	endpoint: string,
	scopes: string[],
	fallbackScopes: string[] = [],
): ProviderProfile {
	return {
		id,
		label: id,
		endpoint,
		redirectPort: 8143,
		scopes,
		fallbackScopes,
		clientName: "DeepSeek Harness",
		toolNamespace: id,
		credentialKey: `${id}/mcp`,
		debug: false,
	};
}

const ATLASSIAN_CLASSIC = [
	"offline_access",
	"read:jira-work",
	"write:jira-work",
	"read:jira-user",
];

const PROVIDERS: { name: string; target: ProviderProfile }[] = [
	{
		name: "Atlassian v1",
		target: profile(
			"atlassian-v1",
			"https://mcp.atlassian.com/v1/mcp",
			[...ATLASSIAN_CLASSIC, "read:jira:agent-interface"],
			ATLASSIAN_CLASSIC,
		),
	},
	{
		name: "Atlassian v2",
		target: profile(
			"atlassian-v2",
			"https://mcp.atlassian.com/v2/mcp",
			["offline_access", "read:jira:agent-interface", "read:jira-work"],
			ATLASSIAN_CLASSIC,
		),
	},
	{
		name: "Sentry",
		target: profile("sentry", "https://mcp.sentry.dev/mcp", [
			"org:read",
			"project:write",
		]),
	},
	{
		name: "GitLab",
		target: profile("gitlab", "https://gitlab.com/api/v4/mcp", ["mcp"]),
	},
	{
		name: "Figma",
		target: profile("figma", "https://mcp.figma.com/mcp", ["mcp:connect"]),
	},
];

for (const { name, target } of PROVIDERS) {
	console.log(`\n=== ${name} ===`);

	try {
		const server = await discover(target);

		check("issuer resolved", server.issuer !== "", server.issuer);
		check(
			"authorization endpoint is absolute",
			server.authorizationEndpoint.startsWith("https://"),
			server.authorizationEndpoint,
		);
		check(
			"token endpoint is absolute",
			server.tokenEndpoint.startsWith("https://"),
			server.tokenEndpoint,
		);
		check(
			"the resource is the one asked for",
			server.resource === target.endpoint,
			server.resource,
		);
		check(
			"the scopes are the provider's, narrowed to what was advertised",
			server.scopes.length > 0 &&
				server.scopes.every((scope) => target.scopes.includes(scope)),
			server.scopes.join(" "),
		);
		check(
			"dynamic client registration is advertised",
			typeof server.registrationEndpoint === "string",
			String(server.registrationEndpoint),
		);
	} catch (error) {
		check("discovery succeeded", false, String(error));
	}
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

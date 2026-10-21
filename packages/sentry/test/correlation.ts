/**
 * The correlation source: what one Sentry issue contributes to a chain.
 *
 * The answer is the Markdown `get_sentry_resource` actually returns, read by the
 * same parser the panel uses, so this proves the hop wiring rather than the
 * parser, which `parse.ts` already covers.
 *
 *   bun run test/correlation.ts
 */

import { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { sentryCorrelationSource } from "../src/host/correlation";
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

interface Call {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

/** One issue document, as the server printed it. */
const ISSUE = `# Issue CHECKOUT-13P in **acme**

**Description**: AxiosError: Request failed with status code 422
**Status**: unresolved
**Occurrences**: 35

## Code Location

**Repository**: Acme / storefront
**Path**: src/capture.ts
**Line**: 60
**Source**: https://gitlab.com/acme/storefront/-/blob/c379884/src/capture.ts

## Suspect Commit

**SHA**: \`7c50a1e57b5a523da90bef0df35f5a6d87b772ed\`
**Message**: DEV-5977: Handle split 500 error codes on exchange creation
**Author**: Grace Hopper
**Source**: via SCM integration

### Tags

**release**: storefront@3.0.1
**environment**: production
`;

const calls: Call[] = [];

const bridge = {
	callTool: async (name: string, args: Record<string, unknown>) => {
		calls.push({ name, args });

		return { content: [{ type: "text", text: ISSUE }] };
	},
} as unknown as McpBridge;

function signedIn(): RuntimeState<OrganizationFacts> {
	const state = new RuntimeState<OrganizationFacts>();

	state.facts = new OrganizationFacts({
		slug: "acme",
		webUrl: "https://acme.sentry.io",
	});

	return state;
}

const source = sentryCorrelationSource({ bridge, state: signedIn() });

console.log("\n=== what the source offers ===");
check(
	"one entry kind, and it resolves only its own",
	source.provider === "Sentry" &&
		source.entry === "error" &&
		source.resolves.join(",") === "error",
	`${source.provider} · ${source.entry} · ${source.resolves.join(",")}`,
);

console.log("\n=== one issue as a hop ===");
{
	const facts = await source.resolve({ kind: "error", id: "CHECKOUT-13P" });
	const fact = facts[0];

	check(
		"the issue is read through the same tool the panel reads it with",
		calls[0]?.name === "get_sentry_resource" &&
			calls[0]?.args.resourceType === "issue" &&
			calls[0]?.args.resourceId === "CHECKOUT-13P" &&
			calls[0]?.args.organizationSlug === "acme",
		JSON.stringify(calls[0]),
	);
	check(
		"the hop is the issue, named by its own id",
		fact?.id === "sentry:CHECKOUT-13P" &&
			fact.kind === "error" &&
			fact.label === "Error" &&
			fact.title ===
				"CHECKOUT-13P · AxiosError: Request failed with status code 422",
		JSON.stringify(fact),
	);
	check(
		"and carries the one detail a card has room for",
		fact?.meta ===
			"unresolved · 35 events · release storefront@3.0.1 · production",
		fact?.meta ?? "",
	);

	const commit = fact?.references?.find((ref) => ref.kind === "commit");
	const task = fact?.references?.find((ref) => ref.kind === "task");

	check(
		"the suspect commit is pointed at, with somewhere to look for it",
		commit?.kind === "commit" &&
			commit.sha === "7c50a1e57b5a523da90bef0df35f5a6d87b772ed" &&
			commit.url ===
				"https://gitlab.com/acme/storefront/-/blob/c379884/src/capture.ts" &&
			commit.repository === "Acme / storefront" &&
			commit.label === "Suspect commit 7c50a1e",
		JSON.stringify(commit),
	);
	check(
		"the key the commit message names is pointed at too",
		task?.kind === "task" && task.key === "DEV-5977",
		JSON.stringify(task),
	);
}

console.log("\n=== what it declines and what it reports ===");
{
	check(
		"a reference of another kind is not its business",
		(await source.resolve({ kind: "task", key: "DEV-1" })).length === 0,
	);

	const anonymous = sentryCorrelationSource({
		bridge,
		state: new RuntimeState<OrganizationFacts>(),
	});
	const refused = await anonymous
		.resolve({ kind: "error", id: "CHECKOUT-13P" })
		.then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

	check(
		"an installation that is not signed in says so rather than answering nothing",
		refused.includes("/sentry sync"),
		refused,
	);

	const empty = sentryCorrelationSource({
		bridge: {
			callTool: async () => ({
				content: [{ type: "text", text: "# Nothing" }],
			}),
		} as unknown as McpBridge,
		state: signedIn(),
	});
	const missing = await empty.resolve({ kind: "error", id: "NOPE-1" }).then(
		() => "",
		(error: unknown) => (error as Error).message,
	);

	check(
		"an id Sentry does not know is reported, not answered with an empty hop",
		missing.includes("NOPE-1"),
		missing,
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

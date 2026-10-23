/**
 * The correlation source: what one Sentry issue contributes to a chain.
 *
 * The answer is the Markdown `get_sentry_resource` actually returns, read by the
 * same parser the panel uses, so this proves the hop wiring rather than the
 * parser, which `parse.ts` already covers.
 *
 *   bun run test/correlation.ts
 */

import { expect, test } from "bun:test";
import { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { sentryCorrelationSource } from "../src/host/correlation";
import { OrganizationFacts } from "../src/host/store/organization";

test("the correlation source", async () => {
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
	expect(
		source.provider === "Sentry" &&
			source.entry === "error" &&
			source.resolves.join(",") === "error",
		`one entry kind, and it resolves only its own — ${`${source.provider} · ${source.entry} · ${source.resolves.join(",")}`}`,
	).toBe(true);

	console.log("\n=== one issue as a hop ===");
	{
		const facts = await source.resolve({ kind: "error", id: "CHECKOUT-13P" });
		const fact = facts[0];

		expect(
			calls[0]?.name === "get_sentry_resource" &&
				calls[0]?.args.resourceType === "issue" &&
				calls[0]?.args.resourceId === "CHECKOUT-13P" &&
				calls[0]?.args.organizationSlug === "acme",
			`the issue is read through the same tool the panel reads it with — ${JSON.stringify(calls[0])}`,
		).toBe(true);
		expect(
			fact?.id === "sentry:CHECKOUT-13P" &&
				fact.kind === "error" &&
				fact.label === "Error" &&
				fact.title ===
					"CHECKOUT-13P · AxiosError: Request failed with status code 422",
			`the hop is the issue, named by its own id — ${JSON.stringify(fact)}`,
		).toBe(true);
		expect(
			fact?.meta ===
				"unresolved · 35 events · release storefront@3.0.1 · production",
			`and carries the one detail a card has room for — ${fact?.meta ?? ""}`,
		).toBe(true);

		const commit = fact?.references?.find((ref) => ref.kind === "commit");
		const task = fact?.references?.find((ref) => ref.kind === "task");

		expect(
			commit?.kind === "commit" &&
				commit.sha === "7c50a1e57b5a523da90bef0df35f5a6d87b772ed" &&
				commit.url ===
					"https://gitlab.com/acme/storefront/-/blob/c379884/src/capture.ts" &&
				commit.repository === "Acme / storefront" &&
				commit.label === "Suspect commit 7c50a1e",
			`the suspect commit is pointed at, with somewhere to look for it — ${JSON.stringify(commit)}`,
		).toBe(true);
		expect(
			task?.kind === "task" && task.key === "DEV-5977",
			`the key the commit message names is pointed at too — ${JSON.stringify(task)}`,
		).toBe(true);
	}

	console.log("\n=== what it declines and what it reports ===");
	{
		expect(
			(await source.resolve({ kind: "task", key: "DEV-1" })).length === 0,
			"a reference of another kind is not its business",
		).toBe(true);

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

		expect(
			refused.includes("/sentry sync"),
			`an installation that is not signed in says so rather than answering nothing — ${refused}`,
		).toBe(true);

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

		expect(
			missing.includes("NOPE-1"),
			`an id Sentry does not know is reported, not answered with an empty hop — ${missing}`,
		).toBe(true);
	}
});

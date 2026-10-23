/**
 * The digest source: which search each block runs, and what a Sentry answer
 * becomes as a digest row.
 *
 *   bun run test/digest.ts
 *
 * The answer is the Markdown `search_issues` actually returns, read by the same
 * parser `sentry_present` uses, so this proves the block wiring rather than the
 * parser, which `parse.ts` already covers.
 */

import { test } from "bun:test";
import type { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { check } from "../../../test/support";
import { sentryDigestSource } from "../src/host/digest";
import type { OrganizationFacts } from "../src/host/store/organization";

test("the digest source", async () => {
	interface Call {
		readonly name: string;
		readonly args: Readonly<Record<string, unknown>>;
	}

	const ANSWER = `# Search Results for "is:unresolved"

Found **2** issues:

## 1. [FRONTEND-13P](https://acme.sentry.io/issues/13P)

**AxiosError: Request failed with status code 422**

- **Status**: unresolved
- **Users**: 12
- **Events**: 48

## 2. [BACKEND-7Q](https://acme.sentry.io/issues/7Q)

**TimeoutError: upstream did not answer**

- **Status**: unresolved
- **Events**: 3
`;

	const calls: Call[] = [];

	const bridge = {
		callTool: async (name: string, args: Record<string, unknown>) => {
			calls.push({ name, args });

			return { content: [{ type: "text", text: ANSWER }] };
		},
	} as unknown as McpBridge;

	const state = {
		facts: { slug: "acme", webUrl: "https://acme.sentry.io" },
	} as unknown as RuntimeState<OrganizationFacts>;

	const source = sentryDigestSource({ bridge, state });

	console.log("=== what the source offers ===");
	check(
		"one block, on by default",
		source.blocks.length === 1 &&
			source.blocks[0]?.id === "sentry-errors" &&
			source.blocks[0]?.defaultOn === true,
		source.blocks.map((block) => block.id).join(","),
	);
	check("it names its provider", source.provider === "Sentry");

	console.log("\n=== the block ===");
	{
		const items = await source.load("sentry-errors", {
			since: new Date(0),
			limit: 10,
		});
		const call = calls.at(-1);

		check(
			"asks Sentry's own search",
			call?.name === "search_issues",
			call?.name,
		);
		check("for the known organization", call?.args.organizationSlug === "acme");
		check("for unresolved issues", call?.args.query === "is:unresolved");
		check("within the digest's window", call?.args.period === "24h");
		check(
			"newest first, and capped",
			call?.args.sort === "new" && call?.args.limit === 10,
		);

		check("one row per issue", items.length === 2);
		check(
			"a row leads with the short id and the exception",
			items[0]?.title ===
				"FRONTEND-13P · AxiosError: Request failed with status code 422",
			items[0]?.title,
		);
		check(
			"and carries the counts beside it",
			items[0]?.meta === "unresolved · 12 users · 48 events",
			items[0]?.meta,
		);
		check(
			"the link is Sentry's own",
			items[0]?.url === "https://acme.sentry.io/issues/13P",
		);
		check(
			"a row with no user count says only what it knows",
			items[1]?.meta === "unresolved · 3 events",
			items[1]?.meta,
		);
	}

	console.log("\n=== what it refuses ===");
	{
		const missing = await sentryDigestSource({
			bridge,
			state: { facts: undefined } as unknown as RuntimeState<OrganizationFacts>,
		})
			.load("sentry-errors", { since: new Date(0), limit: 5 })
			.then(() => "")
			.catch((error: unknown) => (error as Error).message);

		check(
			"an organization that is not known yet says what to do",
			missing.includes("sign in") && missing.includes("/sentry sync"),
			missing,
		);
	}
});

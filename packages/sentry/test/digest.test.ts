/**
 * The digest source: which search each block runs, and what a Sentry answer
 * becomes as a digest row.
 *
 * The answer is the Markdown `search_issues` actually returns, read by the same
 * parser `sentry_present` uses, so this proves the block wiring rather than the
 * parser, which `parse.test.ts` already covers.
 */

import { expect, test } from "bun:test";
import type { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { sentryDigestSource } from "../src/host/digest";
import type { OrganizationFacts } from "../src/host/store/organization";

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

test("a source with one block, on by default", () => {
	expect(
		source.blocks.length === 1 &&
			source.blocks[0]?.id === "sentry-errors" &&
			source.blocks[0]?.defaultOn === true,
		`one block, on by default — ${source.blocks.map((block) => block.id).join(",")}`,
	).toBe(true);
});

test("the block asks Sentry's search for the digest's window", async () => {
	const items = await source.load("sentry-errors", {
		since: new Date(0),
		limit: 10,
	});
	const call = calls.at(-1);

	expect(
		call?.name === "search_issues",
		`asks Sentry's own search — ${call?.name}`,
	).toBe(true);
	expect(
		call?.args.organizationSlug === "acme",
		"for the known organization",
	).toBe(true);
	expect(
		call?.args.query === "is:unresolved firstSeen:-24h",
		"for unresolved issues first seen in the window",
	).toBe(true);
	expect(call?.args.period === "24h", "within the digest's window").toBe(true);
	expect(
		call?.args.sort === "new" && call?.args.limit === 10,
		"newest first, and capped",
	).toBe(true);

	expect(items.length === 2, "one row per issue").toBe(true);
	expect(
		items[0]?.title ===
			"FRONTEND-13P · AxiosError: Request failed with status code 422",
		`a row leads with the short id and the exception — ${items[0]?.title}`,
	).toBe(true);
	expect(
		items[0]?.meta === "unresolved · 12 users · 48 events",
		`and carries the counts beside it — ${items[0]?.meta}`,
	).toBe(true);
	expect(
		items[0]?.url === "https://acme.sentry.io/issues/13P",
		"the link is Sentry's own",
	).toBe(true);
	expect(
		items[1]?.meta === "unresolved · 3 events",
		`a row with no user count says only what it knows — ${items[1]?.meta}`,
	).toBe(true);
});

test("an organization that is not known yet says what to do", async () => {
	const missing = await sentryDigestSource({
		bridge,
		state: { facts: undefined } as unknown as RuntimeState<OrganizationFacts>,
	})
		.load("sentry-errors", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	expect(
		missing.includes("sign in") && missing.includes("/sentry sync"),
		`an organization that is not known yet says what to do — ${missing}`,
	).toBe(true);
});

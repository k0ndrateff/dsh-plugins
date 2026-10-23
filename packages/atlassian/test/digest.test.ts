/**
 * The digest source: which JQL each block runs, and what a Jira answer becomes
 * as a digest row.
 *
 * The answer below is the shape Atlassian's MCP server actually returns — JSON
 * inside a text content block — and it is read by the same extractor the
 * `atlassian_present` tool uses, so this proves the block wiring rather than the
 * extractor, which `dry-run.ts` already covers.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import type { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { atlassianDigestSource } from "../src/host/digest";
import type { SiteFacts } from "../src/host/store/site";

/** One call the fake bridge was asked to make. */
interface Call {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

/** The answer one `searchJiraIssuesUsingJql` returns. */
const ANSWER = {
	content: [
		{
			type: "text",
			text: JSON.stringify({
				issues: [
					{
						key: "DEV-6477",
						fields: {
							summary: "Fix the parser",
							status: { name: "In Progress" },
							priority: { name: "High" },
							issuetype: { name: "Bug" },
						},
					},
					{
						key: "DQ-66",
						fields: {
							summary: "Ship the digest",
							status: { name: "To Do" },
						},
					},
				],
			}),
		},
	],
};

const calls: Call[] = [];

const bridge = {
	callTool: async (name: string, args: Record<string, unknown>) => {
		calls.push({ name, args });

		return ANSWER;
	},
} as unknown as McpBridge;

const state = {
	facts: { cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net" },
} as unknown as RuntimeState<SiteFacts>;

const source = atlassianDigestSource({ bridge, state });

describe("the source's blocks", () => {
	test("two Jira blocks, both on by default", () => {
		expect(
			source.blocks.map((block) => `${block.id}:${block.defaultOn}`).join(","),
		).toBe("jira-active:true,jira-queued:true");
	});
});

describe("the active block", () => {
	let items: Awaited<ReturnType<typeof source.load>> = [];

	beforeAll(async () => {
		calls.length = 0;
		items = await source.load("jira-active", {
			since: new Date(0),
			limit: 10,
		});
	});

	test("asks the Jira search tool with the site and the row cap", () => {
		expect(calls.at(-1)?.name).toBe("searchJiraIssuesUsingJql");
		expect(calls.at(-1)?.args.cloudId).toBe("cloud-1");
		expect(calls.at(-1)?.args.maxResults).toBe(10);
	});

	test("asks for open work assigned to the user, in progress or overdue", () => {
		const jql = String(calls.at(-1)?.args.jql);

		expect(jql).toContain('statusCategory = "In Progress"');
		expect(jql).toContain("duedate <= now()");
		expect(jql).toContain("statusCategory != Done");
	});

	test("turns each issue into one row", () => {
		expect(items).toHaveLength(2);
		expect(items[0]?.title).toBe("DEV-6477 · Fix the parser");
		expect(items[0]?.meta).toBe("In Progress · High");
		expect(items[0]?.url).toBe("https://acme.atlassian.net/browse/DEV-6477");
	});

	test("a row with no priority says only what it knows", () => {
		expect(items[1]?.meta).toBe("To Do");
	});
});

describe("the queued block", () => {
	test("asks for work that has not started", async () => {
		calls.length = 0;
		await source.load("jira-queued", { since: new Date(0), limit: 5 });

		expect(String(calls.at(-1)?.args.jql)).toContain(
			'statusCategory = "To Do"',
		);
	});
});

describe("what it refuses", () => {
	test("an unknown block is an error", async () => {
		const unknown = await source
			.load("jira-nonsense", { since: new Date(0), limit: 5 })
			.then(
				() => "",
				(error: unknown) => (error as Error).message,
			);

		expect(unknown).toContain("no Jira block");
	});

	test("a site that is not known yet says which command learns it", async () => {
		const unconnected = atlassianDigestSource({
			bridge,
			state: { facts: undefined } as unknown as RuntimeState<SiteFacts>,
		});
		const missing = await unconnected
			.load("jira-active", { since: new Date(0), limit: 5 })
			.then(
				() => "",
				(error: unknown) => (error as Error).message,
			);

		expect(missing).toContain("/atlassian sync");
	});
});

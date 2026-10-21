/**
 * The digest source: which JQL each block runs, and what a Jira answer becomes
 * as a digest row.
 *
 *   bun run test/digest.ts
 *
 * The answer below is the shape Atlassian's MCP server actually returns — JSON
 * inside a text content block — and it is read by the same extractor the
 * `atlassian_present` tool uses, so this proves the block wiring rather than the
 * extractor, which `dry-run.ts` already covers.
 */

import type { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { atlassianDigestSource } from "../src/host/digest";
import type { SiteFacts } from "../src/host/store/site";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

console.log("=== what the source offers ===");
check(
	"two Jira blocks, both on by default",
	source.blocks.map((block) => `${block.id}:${block.defaultOn}`).join(",") ===
		"jira-active:true,jira-queued:true",
	source.blocks.map((block) => block.id).join(","),
);
check("it names its provider", source.provider === "Atlassian");

console.log("\n=== the active block ===");
{
	const items = await source.load("jira-active", {
		since: new Date(0),
		limit: 10,
	});
	const call = calls.at(-1);

	check(
		"asks the Jira search tool",
		call?.name === "searchJiraIssuesUsingJql",
		call?.name,
	);
	check("with the site's cloud id", call?.args.cloudId === "cloud-1");
	check("and the row cap", call?.args.maxResults === 10);
	check(
		"for open work assigned to the user, in progress or overdue",
		String(call?.args.jql).includes('statusCategory = "In Progress"') &&
			String(call?.args.jql).includes("duedate <= now()") &&
			String(call?.args.jql).includes("statusCategory != Done"),
		String(call?.args.jql),
	);

	check("one row per issue", items.length === 2);
	check(
		"a row leads with the key and the summary",
		items[0]?.title === "DEV-6477 · Fix the parser",
		items[0]?.title,
	);
	check(
		"and carries the status and priority beside it",
		items[0]?.meta === "In Progress · High",
		items[0]?.meta,
	);
	check(
		"the link is the site's own browse URL",
		items[0]?.url === "https://acme.atlassian.net/browse/DEV-6477",
		items[0]?.url,
	);
	check(
		"a row with no priority says only what it knows",
		items[1]?.meta === "To Do",
		items[1]?.meta,
	);
}

console.log("\n=== the queued block ===");
await source.load("jira-queued", { since: new Date(0), limit: 5 });

check(
	"asks for work that has not started",
	String(calls.at(-1)?.args.jql).includes('statusCategory = "To Do"'),
	String(calls.at(-1)?.args.jql),
);

console.log("\n=== what it refuses ===");
{
	const unknown = await source
		.load("jira-nonsense", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	check(
		"an unknown block is an error",
		unknown.includes("no Jira block"),
		unknown,
	);

	const unconnected = atlassianDigestSource({
		bridge,
		state: { facts: undefined } as unknown as RuntimeState<SiteFacts>,
	});
	const missing = await unconnected
		.load("jira-active", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	check(
		"a site that is not known yet says which command learns it",
		missing.includes("/atlassian sync"),
		missing,
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

process.exit(failures > 0 ? 1 : 0);

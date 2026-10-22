/**
 * The correlation source: what Atlassian contributes to a chain.
 *
 * One entry kind and one read: the ticket a chain ended at. What is worth
 * checking is that the hop is the issue as Jira words it — key, summary, status,
 * and the site link the panel and the card both need — and that an installation
 * with no site yet says so instead of quietly answering nothing.
 *
 *   bun run test/correlation.ts
 */

import { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { atlassianCorrelationSource } from "../src/host/correlation";
import { SiteFacts } from "../src/host/store/site";

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

/** One issue as `getJiraIssue` answers with it. */
const ISSUE = {
	key: "DEV-5977",
	fields: {
		summary: "Handle split 500 error codes",
		status: { name: "In Review" },
		issuetype: { name: "Bug" },
		priority: { name: "High" },
		assignee: { displayName: "Ada Lovelace" },
	},
};

const calls: Call[] = [];

const bridge = {
	callTool: async (name: string, args: Record<string, unknown>) => {
		calls.push({ name, args });

		return { content: [{ type: "text", text: JSON.stringify(ISSUE) }] };
	},
} as unknown as McpBridge;

function onSite(siteUrl: string, cloudId: string): RuntimeState<SiteFacts> {
	const state = new RuntimeState<SiteFacts>();

	state.facts = new SiteFacts({ siteUrl, cloudId });

	return state;
}

const source = atlassianCorrelationSource({
	bridge,
	state: onSite("https://acme.atlassian.net", "cloud-1"),
});

console.log("\n=== what the source offers ===");
check(
	"one entry kind, and it resolves only its own",
	source.provider === "Atlassian" &&
		source.entry === "task" &&
		source.resolves.join(",") === "task",
	`${source.provider} · ${source.entry} · ${source.resolves.join(",")}`,
);

console.log("\n=== one ticket as a hop ===");
{
	const facts = await source.resolve({ kind: "task", key: "DEV-5977" });
	const fact = facts[0];

	check(
		"the issue is read by key, on the account's own site",
		calls[0]?.name === "getJiraIssue" &&
			calls[0]?.args.issueIdOrKey === "DEV-5977" &&
			calls[0]?.args.cloudId === "cloud-1" &&
			calls[0]?.args.responseContentFormat === "markdown",
		JSON.stringify(calls[0]),
	);
	check(
		"and asks for the fields a hop shows, and no more",
		JSON.stringify(calls[0]?.args.fields) ===
			'["summary","status","assignee","issuetype","priority"]',
		JSON.stringify(calls[0]?.args.fields),
	);
	check(
		"the hop is the issue, named by its key",
		fact?.id === "jira:DEV-5977" &&
			fact.kind === "task" &&
			fact.label === "Jira issue" &&
			fact.title === "DEV-5977 · Handle split 500 error codes",
		JSON.stringify(fact),
	);
	check(
		"with everything the panel's header would show",
		fact?.meta === "In Review · Bug · High · Ada Lovelace" &&
			fact.url === "https://acme.atlassian.net/browse/DEV-5977",
		`${fact?.meta ?? ""} · ${fact?.url ?? ""}`,
	);
	check(
		"and a ticket is the end of a chain as it stands, so it points nowhere",
		fact?.references === undefined,
		JSON.stringify(fact?.references),
	);
}

console.log("\n=== what it declines and what it reports ===");
{
	check(
		"a reference of another kind is not its business",
		(await source.resolve({ kind: "commit", sha: "7c50a1e5" })).length === 0,
	);

	const anonymous = atlassianCorrelationSource({
		bridge,
		state: new RuntimeState<SiteFacts>(),
	});
	const refused = await anonymous
		.resolve({ kind: "task", key: "DEV-5977" })
		.then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

	check(
		"an installation with no site yet says so rather than answering nothing",
		refused.includes("/atlassian sync"),
		refused,
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

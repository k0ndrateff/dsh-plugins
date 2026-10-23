/**
 * The correlation source: what Atlassian contributes to a chain.
 *
 * One entry kind and one read: the ticket a chain ended at. What is worth
 * checking is that the hop is the issue as Jira words it — key, summary, status,
 * and the site link the panel and the card both need — and that an installation
 * with no site yet says so instead of quietly answering nothing.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CorrelationFact } from "dsh-integration-host";
import { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { atlassianCorrelationSource } from "../src/host/correlation";
import { SiteFacts } from "../src/host/store/site";

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

const bridge = {
	callTool: mock(async (_name: string, _args: Record<string, unknown>) => {
		return { content: [{ type: "text", text: JSON.stringify(ISSUE) }] };
	}),
};

const onSite = (siteUrl: string, cloudId: string): RuntimeState<SiteFacts> => {
	const state = new RuntimeState<SiteFacts>();

	state.facts = new SiteFacts({ siteUrl, cloudId });

	return state;
};

const source = atlassianCorrelationSource({
	bridge: bridge as unknown as McpBridge,
	state: onSite("https://acme.atlassian.net", "cloud-1"),
});

describe("what the source offers", () => {
	test("one entry kind, and it resolves only its own", () => {
		expect(source.provider).toBe("Atlassian");
		expect(source.entry).toBe("task");
		expect(source.resolves.join(",")).toBe("task");
	});
});

describe("one ticket as a hop", async () => {
	let fact: CorrelationFact | null = null;

	beforeEach(async () => {
		const facts = await source.resolve({ kind: "task", key: "DEV-5977" });
		fact = facts[0];
	});

	test("the issue is read by key, on the account's own site", () => {
		expect(bridge.callTool).toHaveBeenCalledWith("getJiraIssue", {
			fields: ["summary", "status", "assignee", "issuetype", "priority"],
			issueIdOrKey: "DEV-5977",
			cloudId: "cloud-1",
			responseContentFormat: "markdown",
		});
	});

	test("the hop is the issue, named by its key", () => {
		expect(fact).toBeDefined();
		expect(fact?.id).toBe("jira:DEV-5977");
		expect(fact?.kind).toBe("task");
		expect(fact?.label).toBe("Jira issue");
		expect(fact?.title).toBe("DEV-5977 · Handle split 500 error codes");
	});

	test("with everything the panel's header would show", () => {
		expect(fact).toBeDefined();
		expect(fact?.meta).toBe("In Review · Bug · High · Ada Lovelace");
		expect(fact?.url).toBe("https://acme.atlassian.net/browse/DEV-5977");
	});

	test("and a ticket is the end of a chain as it stands, so it points nowhere", () => {
		expect(fact).toBeDefined();
		expect(fact?.references).toBeUndefined();
	});
});

describe("what it declines and what it reports", () => {
	test("a reference of another kind is not its business", async () => {
		const facts = await source.resolve({ kind: "commit", sha: "7c50a1e5" });

		expect(facts).toHaveLength(0);
	});

	test("an installation with no site yet says so rather than answering nothing", async () => {
		const anonymous = atlassianCorrelationSource({
			bridge: bridge as unknown as McpBridge,
			state: new RuntimeState<SiteFacts>(),
		});

		const refused = await anonymous
			.resolve({ kind: "task", key: "DEV-5977" })
			.then(
				() => "",
				(error: unknown) => (error as Error).message,
			);

		expect(refused).toContain("/atlassian sync");
	});
});

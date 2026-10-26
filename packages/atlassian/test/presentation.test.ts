/**
 * The behaviours the UX/AX audit asked for: tool errors are errors, per-item
 * failures keep their reason, URLs are accepted, limits reach the model, and a
 * card or panel works with the site it names.
 *
 * These run against a bridge that answers from a script; the live server is
 * covered by `dry-run`, and the provider's own Markdown by `readers`.
 */

import { describe, expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { RuntimeState } from "dsh-integration-host";
import type { GrantStore, McpBridge } from "dsh-mcp-oauth";
import { PanelApi } from "../src/host/panels/panel";
import { SiteFacts, siteFacts } from "../src/host/store/site";
import { issueKeyOf, pageIdOf, presentTool } from "../src/host/tools/present";
import { withWriteInstruction } from "../src/host/tools/write-instruction";
import { asPresentation } from "../src/shared/presentation";

/** One call the fake bridge was asked to make. */
interface Call {
	readonly name: string;
	readonly args: Record<string, unknown>;
}

/** A bridge that answers from a script, and records what it was asked. */
function fakeBridge(answer: (call: Call) => unknown): {
	bridge: McpBridge;
	calls: Call[];
} {
	const calls: Call[] = [];

	return {
		calls,
		bridge: {
			callTool: async (name: string, args: Record<string, unknown>) => {
				const call = { name, args };
				calls.push(call);

				return answer(call);
			},
			toolNames: [],
			isConnected: true,
		} as unknown as McpBridge,
	};
}

/** One MCP result carrying a text block of JSON. */
const text = (value: unknown): unknown => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

/** A runtime state that knows two sites, the way a multi-site account does. */
function twoSites(): RuntimeState<SiteFacts> {
	const state = new RuntimeState<SiteFacts>();

	state.facts = new SiteFacts({
		sites: [
			{ url: "https://alpha.atlassian.net", cloudId: "cloud-a" },
			{ url: "https://beta.atlassian.net", cloudId: "cloud-b" },
		],
		siteUrl: "https://alpha.atlassian.net",
		cloudId: "cloud-a",
	});

	return state;
}

/** A context without a model: the gist pass then simply finds no summaries. */
const context = { get: () => undefined } as unknown as Context;

/** One tool execution, as far as the tool reads it. */
function execution(): ToolRunContext {
	return {
		callId: "call-1",
		signal: new AbortController().signal,
		agent: {},
	} as unknown as ToolRunContext;
}

/** The issue document the fake server answers with. */
const ISSUE = {
	key: "DEV-1",
	fields: {
		summary: "Fix the parser",
		status: { name: "In Progress" },
		comment: {
			comments: [{ body: "a comment", author: { displayName: "A" } }],
			total: 87,
		},
	},
};

describe("a URL is accepted where a key is", () => {
	test("an issue key is read out of a browse URL", () => {
		expect(issueKeyOf("https://acme.atlassian.net/browse/DEV-6477")).toBe(
			"DEV-6477",
		);
		expect(
			issueKeyOf("https://acme.atlassian.net/browse/DEV-6477?atlOrigin=abc"),
		).toBe("DEV-6477");
	});

	test("a page id is read out of either Confluence URL", () => {
		expect(
			pageIdOf(
				"https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=988676219",
			),
		).toBe("988676219");
		expect(
			pageIdOf(
				"https://acme.atlassian.net/wiki/spaces/DOC/pages/988676219/Title",
			),
		).toBe("988676219");
	});

	test("a value that is already a key is left alone", () => {
		expect(issueKeyOf("DEV-6477")).toBe("DEV-6477");
		expect(pageIdOf("988676219")).toBe("988676219");
	});
});

describe("atlassian_present", () => {
	test("a search the server refused is an error, not an empty result", async () => {
		const { bridge } = fakeBridge(() => {
			throw new Error("JQL is invalid: unexpected token");
		});
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});

		let failure = "";
		try {
			await definition.execute({ jql: "garbage" }, execution());
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		expect(failure).toContain("JQL is invalid");
	});

	test("a search that matched nothing stays an answer", async () => {
		const { bridge } = fakeBridge(() => text({ issues: [] }));
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});
		const value = (await definition.execute(
			{ jql: "project = NONE" },
			execution(),
		)) as { shown: number; summary: string };

		expect(value.shown).toBe(0);
		expect(value.summary).toContain("No issues or pages matched.");
	});

	test("per-item failures carry the server's reason", async () => {
		const { bridge } = fakeBridge((call) => {
			if (call.args.issueIdOrKey === "NOPE-1")
				throw new Error("Issue does not exist or you lack permission");
			if (call.name === "getJiraIssue") return text(ISSUE);

			throw new Error("unexpected tool");
		});
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});
		const value = (await definition.execute(
			{ issues: ["DEV-1", "NOPE-1"] },
			execution(),
		)) as { shown: number; failed: string[]; summary: string };

		expect(value.shown).toBe(1);
		expect(value.failed).toHaveLength(1);
		expect(value.failed[0]).toContain("NOPE-1 — Issue does not exist");
		expect(value.summary).toContain("NOPE-1 — Issue does not exist");
	});

	test("a URL is resolved through its key", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE));
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});

		await definition.execute(
			{ issues: ["https://acme.atlassian.net/browse/DEV-1"] },
			execution(),
		);

		expect(calls[0]?.args.issueIdOrKey).toBe("DEV-1");
	});

	test("one card reads at most 25 keys, and says how many it dropped", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE));
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});
		const keys = Array.from({ length: 30 }, (_, index) => `DEV-${index + 1}`);
		const value = (await definition.execute({ issues: keys }, execution())) as {
			shown: number;
			summary: string;
			presentation: unknown;
		};

		expect(calls).toHaveLength(25);
		expect(value.shown).toBe(25);
		expect(value.summary).toContain("5 more requested items");
		expect((value.presentation as { total?: number }).total).toBe(30);
	});

	test("the schema and the description carry the cap and the model cost", () => {
		const { bridge } = fakeBridge(() => text(ISSUE));
		const definition: ToolDefinition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});
		const issues = (
			definition.parameters as {
				properties: { issues: { maxItems?: number } };
			}
		).properties.issues;

		expect(issues.maxItems).toBe(25);
		expect(definition.description).toContain("extra model call");
		expect(definition.description).toContain("20 seconds");
		expect(definition.description).toContain("pass cloudId");
	});

	test("the card carries the site it was resolved on", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE));
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: twoSites(),
		});
		const value = (await definition.execute(
			{ issues: ["DEV-1"], cloudId: "cloud-b" },
			execution(),
		)) as { presentation: unknown };

		expect(calls[0]?.args.cloudId).toBe("cloud-b");
		expect(asPresentation(value.presentation)?.cloudId).toBe("cloud-b");
		expect(asPresentation(value.presentation)?.siteUrl).toBe(
			"https://beta.atlassian.net",
		);
	});

	test("no known site names the sync command, not a new sign-in", async () => {
		const { bridge } = fakeBridge(() => text(ISSUE));
		const definition = presentTool.create({
			ctx: context,
			bridge,
			state: new RuntimeState<SiteFacts>(),
		});

		let failure = "";
		try {
			await definition.execute({ issues: ["DEV-1"] }, execution());
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		expect(failure).toContain("/atlassian sync");
	});
});

describe("the panel", () => {
	const panelBridge = (failWorkflow: boolean) =>
		fakeBridge((call) => {
			if (call.name === "getJiraIssue") return text(ISSUE);
			if (call.name === "getTransitionsForJiraIssue") {
				if (failWorkflow) throw new Error("Forbidden: no workflow scope");

				return text({
					transitions: [{ id: "31", name: "Done", to: { name: "Done" } }],
				});
			}

			throw new Error(`unexpected ${call.name}`);
		});

	test("comments say how many exist, not how many were read", async () => {
		const { bridge } = panelBridge(false);
		const panel = new PanelApi({ bridge, state: twoSites() });
		const loaded = await panel.issue("DEV-1");

		expect(loaded.comments).toHaveLength(1);
		expect(loaded.commentTotal).toBe(87);
	});

	test("a failed workflow read says why instead of disappearing", async () => {
		const { bridge } = panelBridge(true);
		const panel = new PanelApi({ bridge, state: twoSites() });
		const loaded = await panel.issue("DEV-1");

		expect(loaded.transitions).toHaveLength(0);
		expect(loaded.transitionsError).toContain("Forbidden");
	});

	test("an explicit site is used for the read and the link", async () => {
		const { bridge, calls } = panelBridge(false);
		const panel = new PanelApi({ bridge, state: twoSites() });
		const loaded = await panel.issue("DEV-1", "cloud-b");

		expect(calls[0]?.args.cloudId).toBe("cloud-b");
		expect(loaded.url).toBe("https://beta.atlassian.net/browse/DEV-1");
	});

	test("the default site is switched without signing out, and remembered", async () => {
		const { bridge } = panelBridge(false);
		const remembered: Record<string, unknown>[] = [];
		const state = twoSites();
		const panel = new PanelApi({
			bridge,
			state,
			store: {
				remember: async (patch: Record<string, unknown>) => {
					remembered.push(patch);
				},
			} as unknown as Pick<GrantStore, "remember">,
		});
		const facts = await panel.selectSite("cloud-b");

		expect(facts.cloudId).toBe("cloud-b");
		expect(state.facts?.siteUrl).toBe("https://beta.atlassian.net");
		expect(remembered.at(-1)?.cloudId).toBe("cloud-b");
	});

	test("an unknown site is refused, not silently replaced", async () => {
		const { bridge } = panelBridge(false);
		const panel = new PanelApi({ bridge, state: twoSites() });

		let failure = "";
		try {
			await panel.selectSite("cloud-zzz");
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		expect(failure).toContain("unknown Atlassian site");
	});
});

describe("the site store", () => {
	test("every site is kept and the first is the default", () => {
		const facts = SiteFacts.parse(
			text([
				{ url: "https://alpha.atlassian.net/", id: "cloud-a" },
				{ url: "https://beta.atlassian.net", id: "cloud-b" },
			]),
		);

		expect(facts.sites).toHaveLength(2);
		expect(facts.cloudId).toBe("cloud-a");
		expect(facts.urlOf("cloud-b")).toBe("https://beta.atlassian.net");
	});

	test("a merge keeps the selected site when the fresh list still offers it", () => {
		const known = new SiteFacts({
			sites: [{ url: "https://beta.atlassian.net", cloudId: "cloud-b" }],
			siteUrl: "https://beta.atlassian.net",
			cloudId: "cloud-b",
		});
		const learned = SiteFacts.parse(
			text([
				{ url: "https://alpha.atlassian.net", id: "cloud-a" },
				{ url: "https://beta.atlassian.net", id: "cloud-b" },
			]),
		);

		const merged = siteFacts.merge(known, learned);

		expect(merged.cloudId).toBe("cloud-b");
		expect(merged.sites).toHaveLength(2);
	});
});

describe("the write instruction", () => {
	test("a write tool tells the agent to report the change", () => {
		const definition: ToolDefinition = {
			name: "executeWrite",
			description: "Gateway for writes.",
			parameters: { type: "object", properties: {} },
			output: {},
			execute: async () => ({}),
		} as unknown as ToolDefinition;
		const decorated = withWriteInstruction(definition, "executeWrite");

		expect(decorated.description).toContain("tell the user what changed");
	});

	test("a read tool keeps the server's own description", () => {
		const definition = {
			name: "getJiraIssue",
			description: "Read one issue.",
		} as unknown as ToolDefinition;

		expect(withWriteInstruction(definition, "getJiraIssue").description).toBe(
			"Read one issue.",
		);
	});
});

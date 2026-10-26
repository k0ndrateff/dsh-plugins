/**
 * The behaviours the UX/AX audit asked for: applicable status actions, the
 * organization a card and panel work with, URLs accepted as ids, limits that
 * reach the model, and the write-tool instruction.
 *
 * The Markdown itself is proved in `parse.test.ts`; this file proves the
 * decisions around it.
 */

import { describe, expect, test } from "bun:test";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { RuntimeState } from "dsh-integration-host";
import type { GrantStore, McpBridge } from "dsh-mcp-oauth";
import {
	applicableStatusActions,
	STATUS_ACTION_LABELS,
	statusText,
} from "../src/client/sidebar/status-actions";
import { PanelApi } from "../src/host/panels/panel";
import { OrganizationFacts } from "../src/host/store/organization";
import { issueIdOf, presentTool } from "../src/host/tools/present";
import { withWriteInstruction } from "../src/host/tools/write-instruction";

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

/** One MCP result carrying a text block. */
const text = (value: string): unknown => ({
	content: [{ type: "text", text: value }],
});

/** The issue document the fake server answers with. */
const ISSUE_DOC = `# Issue CHECKOUT-13P in **acme**

**Description**: AxiosError: Request failed with status code 422
**Status**: unresolved
**Occurrences**: 35
**URL**: https://acme.sentry.io/issues/CHECKOUT-13P
`;

/** The search document the fake server answers with. */
const SEARCH_DOC = `# Search Results for "is:unresolved"

Found **40** issues:

## 1. [CHECKOUT-13P](https://acme.sentry.io/issues/CHECKOUT-13P)

**AxiosError: Request failed with status code 422**

- **Status**: unresolved
- **Events**: 16
`;

/** A runtime state that belongs to two organizations. */
function twoOrganizations(): RuntimeState<OrganizationFacts> {
	const state = new RuntimeState<OrganizationFacts>();

	state.facts = new OrganizationFacts({
		organizations: [
			{ slug: "acme", webUrl: "https://acme.sentry.io" },
			{ slug: "other", webUrl: "https://other.sentry.io" },
		],
		slug: "acme",
		webUrl: "https://acme.sentry.io",
	});

	return state;
}

/** One tool execution, as far as the tool reads it. */
function execution(): ToolRunContext {
	return {
		callId: "call-1",
		signal: new AbortController().signal,
		agent: {},
	} as unknown as ToolRunContext;
}

describe("status actions", () => {
	test("only the changes that apply to the current status are offered", () => {
		expect(applicableStatusActions("resolved")).toEqual(["reopen", "ignore"]);
		expect(applicableStatusActions("ignored")).toEqual(["reopen", "resolve"]);
		expect(applicableStatusActions("unresolved")).toEqual([
			"resolve",
			"ignore",
		]);
	});

	test("an unknown status offers everything rather than guessing", () => {
		expect(applicableStatusActions(undefined)).toHaveLength(3);
		expect(applicableStatusActions("regressed")).toHaveLength(3);
	});

	test("ignore spells out its semantics and status words are readable", () => {
		expect(STATUS_ACTION_LABELS.ignore).toBe("Ignore until it escalates");
		expect(statusText("unresolved")).toBe("Unresolved");
		expect(statusText("closed")).toBe("closed");
	});
});

describe("an issue id", () => {
	test("is read out of a Sentry issue URL", () => {
		expect(issueIdOf("https://acme.sentry.io/issues/CHECKOUT-13P/")).toBe(
			"CHECKOUT-13P",
		);
		expect(
			issueIdOf("https://acme.sentry.io/issues/CHECKOUT-13P/?query=x"),
		).toBe("CHECKOUT-13P");
	});

	test("is left alone when it already is one", () => {
		expect(issueIdOf("CHECKOUT-13P")).toBe("CHECKOUT-13P");
	});
});

describe("sentry_present", () => {
	test("the card names the organization and the limit the search read", async () => {
		const { bridge, calls } = fakeBridge(() => text(SEARCH_DOC));
		const definition = presentTool.create({
			bridge,
			state: twoOrganizations(),
		});
		const value = (await definition.execute(
			{ query: "is:unresolved", limit: 5 },
			execution(),
		)) as {
			shown: number;
			summary: string;
			presentation: { organization?: string; total?: number };
		};

		expect(calls[0]?.args.limit).toBe(5);
		expect(value.presentation.organization).toBe("acme");
		expect(value.summary).toContain("Organization: acme.");
		expect(value.summary).toContain("Sentry matched 40");
		expect(value.summary).toContain("Search read at most 5 issues.");
	});

	test("an id is accepted as the URL a user copies", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE_DOC));
		const definition = presentTool.create({
			bridge,
			state: twoOrganizations(),
		});

		await definition.execute(
			{ issues: ["https://acme.sentry.io/issues/CHECKOUT-13P"] },
			execution(),
		);

		expect(calls[0]?.args.resourceId).toBe("CHECKOUT-13P");
	});

	test("a second organization is used when the call names it", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE_DOC));
		const definition = presentTool.create({
			bridge,
			state: twoOrganizations(),
		});
		const value = (await definition.execute(
			{ issues: ["CHECKOUT-13P"], organization: "other" },
			execution(),
		)) as { presentation: { organization?: string } };

		expect(calls[0]?.args.organizationSlug).toBe("other");
		expect(value.presentation.organization).toBe("other");
	});

	test("the layout description is the one the shared card implements", async () => {
		const { bridge } = fakeBridge(() => text(ISSUE_DOC));
		const definition: ToolDefinition = presentTool.create({
			bridge,
			state: twoOrganizations(),
		});
		const layout = (
			definition.parameters as {
				properties: { layout: { description: string } };
			}
		).properties.layout;

		expect(layout.description).toContain("shows how many items matched");
		expect(definition.description).toContain("suspect");
	});
});

describe("the panel", () => {
	test("an explicit organization is used for the read and its URL", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE_DOC));
		const panel = new PanelApi({ bridge, state: twoOrganizations() });
		const loaded = await panel.issue("CHECKOUT-13P", "other");

		expect(calls[0]?.args.organizationSlug).toBe("other");
		expect(loaded.organization).toBe("other");
		expect(loaded.organizationUrl).toBe("https://other.sentry.io");
	});

	test("a write carries the organization the panel was opened on", async () => {
		const { bridge, calls } = fakeBridge(() => text(ISSUE_DOC));
		const panel = new PanelApi({ bridge, state: twoOrganizations() });

		await panel.setStatus("CHECKOUT-13P", "resolved", undefined, "other");

		expect(calls[0]?.args.organizationSlug).toBe("other");
		expect(calls[1]?.name).toBe("get_sentry_resource");
		expect(calls[1]?.args.organizationSlug).toBe("other");
	});

	test("the default organization is switched without signing out, and remembered", async () => {
		const { bridge } = fakeBridge(() => text(ISSUE_DOC));
		const remembered: Record<string, unknown>[] = [];
		const state = twoOrganizations();
		const panel = new PanelApi({
			bridge,
			state,
			store: {
				remember: async (patch: Record<string, unknown>) => {
					remembered.push(patch);
				},
			} as unknown as Pick<GrantStore, "remember">,
		});
		const facts = await panel.selectOrganization("other");

		expect(facts.slug).toBe("other");
		expect(state.facts?.slug).toBe("other");
		expect(remembered.at(-1)?.organization).toBe("other");
	});

	test("an unknown organization is refused, not silently replaced", async () => {
		const { bridge } = fakeBridge(() => text(ISSUE_DOC));
		const panel = new PanelApi({ bridge, state: twoOrganizations() });

		let failure = "";
		try {
			await panel.selectOrganization("zzz");
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		expect(failure).toContain("unknown Sentry organization");
	});
});

describe("the write instruction", () => {
	test("update_issue tells the agent to report the change", () => {
		const definition = {
			name: "update_issue",
			description: "Change an issue.",
		} as unknown as ToolDefinition;

		expect(
			withWriteInstruction(definition, "update_issue").description,
		).toContain("tell the user what changed");
	});

	test("a read tool keeps the server's own description", () => {
		const definition = {
			name: "search_issues",
			description: "Search.",
		} as unknown as ToolDefinition;

		expect(withWriteInstruction(definition, "search_issues").description).toBe(
			"Search.",
		);
	});
});

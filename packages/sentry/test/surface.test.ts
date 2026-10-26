/**
 * The panel, the card tool, and the route — against a bridge that answers from
 * a script.
 *
 * What matters here is the contract: which MCP tool each operation calls, with
 * which arguments, and what it does with the answer. The Markdown itself is
 * proved in `parse.ts`; this file proves the wiring around it.
 *
 *   bun run test/surface.ts
 */

import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { PanelApi } from "../src/host/panels/panel";
import { OrganizationFacts } from "../src/host/store/organization";
import { createApiHandler, ROUTE_PREFIX } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import type { SentryStatus } from "../src/shared/status";

test("the card, tool and route", async () => {
	/** One call the fake bridge was asked to make. */
	interface Call {
		readonly name: string;
		readonly args: Record<string, unknown>;
	}

	/** A bridge that answers from a script, and records what it was asked. */
	function fakeBridge(answers: (call: Call) => unknown): {
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

					return answers(call);
				},
				toolNames: [],
				isConnected: true,
			} as unknown as McpBridge,
		};
	}

	/** One MCP result carrying a text block. */
	function text(value: string): unknown {
		return { content: [{ type: "text", text: value }] };
	}

	/** The issue document the fake server answers with. */
	const ISSUE_DOC = `# Issue CHECKOUT-13P in **acme**

**Description**: AxiosError: Request failed with status code 422
**Status**: unresolved
**Assigned To**: Ada Lovelace (User)
**Occurrences**: 35
**Users Impacted**: 11
**URL**: https://acme.sentry.io/issues/CHECKOUT-13P

## Suspect Commit

**SHA**: \`7c50a1e57b5a523da90bef0df35f5a6d87b772ed\`
**Message**: DEV-5977: Handle split 500 error codes on exchange creation
**Author**: Grace Hopper
`;

	/** The search answer the fake server answers with. */
	const SEARCH_DOC = `# Search Results for "is:unresolved"

Found **2** issues:

## 1. [CHECKOUT-13P](https://acme.sentry.io/issues/CHECKOUT-13P)

**AxiosError: Request failed with status code 422**

- **Status**: unresolved
- **Events**: 16
- **Users**: 6

## 2. [CHECKOUT-177](https://acme.sentry.io/issues/CHECKOUT-177)

**Error: Hydration failed**

- **Status**: unresolved
- **Events**: 451
`;

	/** A runtime state that already knows its organization. */
	function signedIn(): RuntimeState<OrganizationFacts> {
		const state = new RuntimeState<OrganizationFacts>();

		state.facts = new OrganizationFacts({
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

	/** The text one render call produced. */
	function textOf(definition: ToolDefinition, value: unknown): string {
		return definition.output
			.render({}, value as never)
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("\n");
	}

	console.log("\n=== the panel ===");
	{
		const { bridge, calls } = fakeBridge(() => text(ISSUE_DOC));
		const panel = new PanelApi({ bridge, state: signedIn() });
		const loaded = await panel.issue("CHECKOUT-13P");

		expect(
			calls[0]?.name === "get_sentry_resource" &&
				calls[0]?.args.resourceType === "issue" &&
				calls[0]?.args.resourceId === "CHECKOUT-13P" &&
				calls[0]?.args.organizationSlug === "acme",
			`loading an issue reads it through the resource tool — ${JSON.stringify(calls[0])}`,
		).toBe(true);
		expect(
			loaded.issue.id === "CHECKOUT-13P" &&
				loaded.issue.occurrences === 35 &&
				loaded.organization === "acme",
			`the panel answers with the issue and the organization its actions need — ${`${loaded.issue.id}/${String(loaded.organization)}`}`,
		).toBe(true);
		expect(
			loaded.issue.suspect?.issueKey === "DEV-5977",
			`the suspect commit reaches the panel — ${JSON.stringify(loaded.issue.suspect)}`,
		).toBe(true);

		calls.length = 0;
		await panel.setStatus("CHECKOUT-13P", "resolved");

		expect(
			calls[0]?.name === "update_issue" &&
				calls[0]?.args.status === "resolved" &&
				calls[0]?.args.issueId === "CHECKOUT-13P" &&
				calls[1]?.name === "get_sentry_resource",
			`resolving writes the status and then reloads — ${JSON.stringify(calls.map((call) => call.name))}`,
		).toBe(true);

		calls.length = 0;
		await panel.setStatus("CHECKOUT-13P", "ignored", "untilEscalating");

		expect(
			calls[0]?.args.ignoreMode === "untilEscalating" &&
				calls[0]?.args.status === "ignored",
			`ignoring carries its mode — ${JSON.stringify(calls[0]?.args)}`,
		).toBe(true);

		calls.length = 0;
		await panel.assign("CHECKOUT-13P", "user:123456");

		expect(
			calls[0]?.args.assignedTo === "user:123456",
			`assigning sends Sentry's own assignee format — ${JSON.stringify(calls[0]?.args)}`,
		).toBe(true);

		calls.length = 0;
		await panel.assign("CHECKOUT-13P", null);

		expect(
			calls[0]?.args.assignedTo === null,
			`unassigning sends null rather than an empty string — ${JSON.stringify(calls[0]?.args)}`,
		).toBe(true);

		const anonymous = new PanelApi({
			bridge: fakeBridge(() => text(ISSUE_DOC)).bridge,
			state: new RuntimeState<OrganizationFacts>(),
		});

		let refusal = "";
		try {
			await anonymous.issue("CHECKOUT-13P");
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error);
		}

		expect(
			refusal.includes("organization") && refusal.includes("/sentry sync"),
			`an unknown organization is refused with what to do about it — ${refusal}`,
		).toBe(true);

		const empty = new PanelApi({
			bridge: fakeBridge(() => text("no document here")).bridge,
			state: signedIn(),
		});

		let emptyRefusal = "";
		try {
			await empty.issue("CHECKOUT-13P");
		} catch (error) {
			emptyRefusal = error instanceof Error ? error.message : String(error);
		}

		expect(
			emptyRefusal.includes("CHECKOUT-13P"),
			`an answer that carries no issue is refused — ${emptyRefusal}`,
		).toBe(true);
	}

	console.log("\n=== the card tool ===");
	{
		const { bridge, calls } = fakeBridge((call) =>
			call.name === "search_issues" ? text(SEARCH_DOC) : text(ISSUE_DOC),
		);
		const definition = presentTool.create({ bridge, state: signedIn() });
		const value = (await definition.execute(
			{ query: "unresolved errors", title: "Ошибки" },
			execution(),
		)) as {
			shown: number;
			summary: string;
			failed: string[];
			presentation: { issues: unknown[]; query?: string; layout: string };
		};

		expect(
			calls[0]?.name === "search_issues" &&
				calls[0]?.args.query === "unresolved errors" &&
				calls[0]?.args.organizationSlug === "acme",
			`a search call reaches the search tool with the query — ${JSON.stringify(calls[0]?.args)}`,
		).toBe(true);
		expect(
			value.shown === 2 &&
				value.presentation.issues.length === 2 &&
				value.presentation.layout === "compact",
			`the card carries the rows the search answered with — ${`${String(value.shown)}/${value.presentation.layout}`}`,
		).toBe(true);
		expect(
			value.summary.startsWith('Shown as a card titled "Ошибки": 2 issues.') &&
				value.summary.includes("CHECKOUT-13P") &&
				value.summary.includes("16 events"),
			`the text tells the model what the card shows — ${value.summary.split("\n")[0]}`,
		).toBe(true);
		expect(
			textOf(definition, value) === value.summary,
			"the model's text is what the render returns",
		).toBe(true);
		expect(
			value.presentation !== undefined && value.failed.length === 0,
			"the card payload is the one the browser half validates",
		).toBe(true);

		calls.length = 0;
		const byId = (await definition.execute(
			{ issues: ["CHECKOUT-13P", "NOPE-1"] },
			execution(),
		)) as {
			shown: number;
			failed: string[];
			presentation: { suspect?: unknown };
		};

		expect(
			calls[0]?.name === "get_sentry_resource" &&
				calls[0]?.args.resourceId === "CHECKOUT-13P",
			`an id is resolved through the resource tool — ${JSON.stringify(calls[0]?.args)}`,
		).toBe(true);
		expect(
			byId.failed.length === 0 && byId.shown === 2,
			`an id the server refuses is reported, not thrown — ${`${byId.shown} shown, ${byId.failed.length} failed`}`,
		).toBe(true);

		const { bridge: failing } = fakeBridge((call) => {
			if (call.args.resourceId === "NOPE-1") throw new Error("not found");

			return text(ISSUE_DOC);
		});
		const partial = (await presentTool
			.create({ bridge: failing, state: signedIn() })
			.execute({ issues: ["CHECKOUT-13P", "NOPE-1"] }, execution())) as {
			shown: number;
			failed: string[];
			summary: string;
		};

		expect(
			partial.failed.length === 1 &&
				partial.failed[0]?.startsWith("NOPE-1 — ") &&
				partial.shown === 1,
			`a refused id is listed as unresolved with the server's reason — ${JSON.stringify(partial.failed)}`,
		).toBe(true);
		expect(
			partial.summary.includes("Could not resolve: NOPE-1 — not found"),
			`the text says what could not be resolved and why — ${partial.summary.split("\n").at(-1)}`,
		).toBe(true);

		let nothing = "";
		try {
			await definition.execute({}, execution());
		} catch (error) {
			nothing = error instanceof Error ? error.message : String(error);
		}

		expect(
			nothing.includes("nothing to show"),
			`a call with neither query nor ids is refused — ${nothing}`,
		).toBe(true);

		const { bridge: emptyBridge } = fakeBridge(() =>
			text("No issues found matching your search criteria"),
		);
		const empty = (await presentTool
			.create({ bridge: emptyBridge, state: signedIn() })
			.execute({ query: "is:unresolved" }, execution())) as {
			shown: number;
			summary: string;
		};

		expect(
			empty.shown === 0 && empty.summary.includes("No issues matched"),
			`a search that matched nothing is an answer — ${empty.summary}`,
		).toBe(true);
	}

	console.log("\n=== the route ===");
	{
		const { bridge } = fakeBridge(() => text(ISSUE_DOC));
		const state = signedIn();
		const status: SentryStatus = {
			signedIn: true,
			inFlight: false,
			expiresAt: null,
			scope: "org:read",
			organization: "acme",
			organizationUrl: "https://acme.sentry.io",
			organizations: [{ slug: "acme", webUrl: "https://acme.sentry.io" }],
			notice: null,
			error: null,
			connected: true,
			tools: ["mcp__sentry__search_issues"],
			endpoint: "https://mcp.sentry.dev/mcp",
		};

		const handler = createApiHandler({
			auth: {
				getStatus: async () => status,
				signIn: async () => ({}),
				signOut: async () => {},
				connect: async () => true,
				loginMessage: () => "Opening your browser…",
				settleNotice: async () => {},
			},
			panel: new PanelApi({ bridge, state }),
		});

		/** One request/response pair, without a socket under it. */
		const call = async (
			method: string,
			path: string,
			body?: unknown,
		): Promise<{ status: number; body: unknown }> => {
			const chunks =
				body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
			const request = {
				method,
				url: path,
				headers: {
					host: "127.0.0.1:52849",
					origin: "http://127.0.0.1:52849",
					"sec-fetch-site": "same-origin",
					"x-dsh-client": "1",
					"content-type": "application/json",
				},
				async *[Symbol.asyncIterator]() {
					for (const chunk of chunks) yield chunk;
				},
			} as unknown as IncomingMessage;

			let code = 0;
			let payload = "";
			const response = {
				writeHead: (value: number) => {
					code = value;

					return response;
				},
				end: (value?: string) => {
					payload = value ?? "";
				},
			} as unknown as ServerResponse;

			await handler(request, response);

			return {
				status: code,
				body: payload === "" ? undefined : JSON.parse(payload),
			};
		};

		const read = await call("GET", `${ROUTE_PREFIX}/status`);

		expect(
			read.status === 200 &&
				(read.body as { organization?: string }).organization === "acme",
			`the settings card reads the status — ${JSON.stringify(read.body).slice(0, 80)}`,
		).toBe(true);

		const loaded = await call("GET", `${ROUTE_PREFIX}/issue?id=CHECKOUT-13P`);

		expect(
			loaded.status === 200 &&
				(loaded.body as { issue?: { id?: string } }).issue?.id ===
					"CHECKOUT-13P",
			`the panel loads an issue by id — ${JSON.stringify(loaded.body).slice(0, 80)}`,
		).toBe(true);

		const resolved = await call("POST", `${ROUTE_PREFIX}/issue/status`, {
			id: "CHECKOUT-13P",
			status: "resolved",
		});

		expect(
			resolved.status === 200 &&
				(resolved.body as { issue?: { id?: string } }).issue?.id ===
					"CHECKOUT-13P",
			`the panel resolves an issue — ${JSON.stringify(resolved.body).slice(0, 80)}`,
		).toBe(true);

		const assigned = await call("POST", `${ROUTE_PREFIX}/issue/assign`, {
			id: "CHECKOUT-13P",
			assignedTo: null,
		});

		expect(assigned.status === 200, "the panel unassigns an issue").toBe(true);

		const missing = await call("POST", `${ROUTE_PREFIX}/issue/status`, {
			id: "CHECKOUT-13P",
		});

		expect(
			missing.status === 400 &&
				String((missing.body as { error?: string }).error).includes("status"),
			`a write without its field is a bad request, not a gateway error — ${`${missing.status}: ${JSON.stringify(missing.body)}`}`,
		).toBe(true);

		const unknown = await call("GET", `${ROUTE_PREFIX}/nope`);

		expect(
			unknown.status === 404,
			`an unknown path is a not-found — ${String(unknown.status)}`,
		).toBe(true);
	}
});

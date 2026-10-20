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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { McpBridge } from "dsh-mcp-oauth";
import { PanelApi } from "../src/host/panels/panel";
import { RuntimeState } from "../src/host/state";
import { createApiHandler, ROUTE_PREFIX } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import type { SentryStatus } from "../src/shared/status";

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
function signedIn(): RuntimeState {
	const state = new RuntimeState();

	state.applyOrganization({ slug: "acme", webUrl: "https://acme.sentry.io" });

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

	check(
		"loading an issue reads it through the resource tool",
		calls[0]?.name === "get_sentry_resource" &&
			calls[0]?.args.resourceType === "issue" &&
			calls[0]?.args.resourceId === "CHECKOUT-13P" &&
			calls[0]?.args.organizationSlug === "acme",
		JSON.stringify(calls[0]),
	);
	check(
		"the panel answers with the issue and the organization its actions need",
		loaded.issue.id === "CHECKOUT-13P" &&
			loaded.issue.occurrences === 35 &&
			loaded.organization === "acme",
		`${loaded.issue.id}/${String(loaded.organization)}`,
	);
	check(
		"the suspect commit reaches the panel",
		loaded.issue.suspect?.issueKey === "DEV-5977",
		JSON.stringify(loaded.issue.suspect),
	);

	calls.length = 0;
	await panel.setStatus("CHECKOUT-13P", "resolved");

	check(
		"resolving writes the status and then reloads",
		calls[0]?.name === "update_issue" &&
			calls[0]?.args.status === "resolved" &&
			calls[0]?.args.issueId === "CHECKOUT-13P" &&
			calls[1]?.name === "get_sentry_resource",
		JSON.stringify(calls.map((call) => call.name)),
	);

	calls.length = 0;
	await panel.setStatus("CHECKOUT-13P", "ignored", "untilEscalating");

	check(
		"ignoring carries its mode",
		calls[0]?.args.ignoreMode === "untilEscalating" &&
			calls[0]?.args.status === "ignored",
		JSON.stringify(calls[0]?.args),
	);

	calls.length = 0;
	await panel.assign("CHECKOUT-13P", "user:123456");

	check(
		"assigning sends Sentry's own assignee format",
		calls[0]?.args.assignedTo === "user:123456",
		JSON.stringify(calls[0]?.args),
	);

	calls.length = 0;
	await panel.assign("CHECKOUT-13P", null);

	check(
		"unassigning sends null rather than an empty string",
		calls[0]?.args.assignedTo === null,
		JSON.stringify(calls[0]?.args),
	);

	const anonymous = new PanelApi({
		bridge: fakeBridge(() => text(ISSUE_DOC)).bridge,
		state: new RuntimeState(),
	});

	let refusal = "";
	try {
		await anonymous.issue("CHECKOUT-13P");
	} catch (error) {
		refusal = error instanceof Error ? error.message : String(error);
	}

	check(
		"an unknown organization is refused with what to do about it",
		refusal.includes("organization") && refusal.includes("/sentry sync"),
		refusal,
	);

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

	check(
		"an answer that carries no issue is refused",
		emptyRefusal.includes("CHECKOUT-13P"),
		emptyRefusal,
	);
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

	check(
		"a search call reaches the search tool with the query",
		calls[0]?.name === "search_issues" &&
			calls[0]?.args.query === "unresolved errors" &&
			calls[0]?.args.organizationSlug === "acme",
		JSON.stringify(calls[0]?.args),
	);
	check(
		"the card carries the rows the search answered with",
		value.shown === 2 &&
			value.presentation.issues.length === 2 &&
			value.presentation.layout === "compact",
		`${String(value.shown)}/${value.presentation.layout}`,
	);
	check(
		"the text tells the model what the card shows",
		value.summary.startsWith('Shown as a card titled "Ошибки": 2 issues.') &&
			value.summary.includes("CHECKOUT-13P") &&
			value.summary.includes("16 events"),
		value.summary.split("\n")[0],
	);
	check(
		"the model's text is what the render returns",
		textOf(definition, value) === value.summary,
	);
	check(
		"the card payload is the one the browser half validates",
		value.presentation !== undefined && value.failed.length === 0,
	);

	calls.length = 0;
	const byId = (await definition.execute(
		{ issues: ["CHECKOUT-13P", "NOPE-1"] },
		execution(),
	)) as {
		shown: number;
		failed: string[];
		presentation: { suspect?: unknown };
	};

	check(
		"an id is resolved through the resource tool",
		calls[0]?.name === "get_sentry_resource" &&
			calls[0]?.args.resourceId === "CHECKOUT-13P",
		JSON.stringify(calls[0]?.args),
	);
	check(
		"an id the server refuses is reported, not thrown",
		byId.failed.length === 0 && byId.shown === 2,
		`${byId.shown} shown, ${byId.failed.length} failed`,
	);

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

	check(
		"a refused id is listed as unresolved",
		partial.failed.join(",") === "NOPE-1" && partial.shown === 1,
		JSON.stringify(partial.failed),
	);
	check(
		"the text says what could not be resolved",
		partial.summary.includes("Could not resolve: NOPE-1"),
		partial.summary.split("\n").at(-1),
	);

	let nothing = "";
	try {
		await definition.execute({}, execution());
	} catch (error) {
		nothing = error instanceof Error ? error.message : String(error);
	}

	check(
		"a call with neither query nor ids is refused",
		nothing.includes("nothing to show"),
		nothing,
	);
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
		notice: null,
		error: null,
		connected: true,
		tools: ["mcp__sentry__search_issues"],
		endpoint: "https://mcp.sentry.dev/mcp",
	};

	const handler = createApiHandler({
		config: {
			endpoint: "https://mcp.sentry.dev/mcp",
			redirectPort: 8144,
			debug: false,
		},
		state,
		auth: {
			getStatus: async () => status,
			signIn: async () => ({}),
			signOut: async () => {},
			connect: async () => true,
			settleNotice: async () => {},
		} as never,
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

	check(
		"the settings card reads the status",
		read.status === 200 &&
			(read.body as { organization?: string }).organization === "acme",
		JSON.stringify(read.body).slice(0, 80),
	);

	const loaded = await call("GET", `${ROUTE_PREFIX}/issue?id=CHECKOUT-13P`);

	check(
		"the panel loads an issue by id",
		loaded.status === 200 &&
			(loaded.body as { issue?: { id?: string } }).issue?.id === "CHECKOUT-13P",
		JSON.stringify(loaded.body).slice(0, 80),
	);

	const resolved = await call("POST", `${ROUTE_PREFIX}/issue/status`, {
		id: "CHECKOUT-13P",
		status: "resolved",
	});

	check(
		"the panel resolves an issue",
		resolved.status === 200 &&
			(resolved.body as { issue?: { id?: string } }).issue?.id ===
				"CHECKOUT-13P",
		JSON.stringify(resolved.body).slice(0, 80),
	);

	const assigned = await call("POST", `${ROUTE_PREFIX}/issue/assign`, {
		id: "CHECKOUT-13P",
		assignedTo: null,
	});

	check("the panel unassigns an issue", assigned.status === 200);

	const missing = await call("POST", `${ROUTE_PREFIX}/issue/status`, {
		id: "CHECKOUT-13P",
	});

	check(
		"a write without its field is a bad request, not a gateway error",
		missing.status === 400 &&
			String((missing.body as { error?: string }).error).includes("status"),
		`${missing.status}: ${JSON.stringify(missing.body)}`,
	);

	const unknown = await call("GET", `${ROUTE_PREFIX}/nope`);

	check(
		"an unknown path is a not-found",
		unknown.status === 404,
		String(unknown.status),
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

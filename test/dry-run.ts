/**
 * Dry run of the host half against Atlassian's live endpoints, with a fake
 * harness context. It covers everything that does not need a human: metadata
 * discovery, dynamic client registration, authorize-URL construction, the
 * loopback callback, the stored record, and cancellation.
 *
 *   bun run test/dry-run.ts
 *
 * It stops short of consenting, so it creates a throwaway OAuth client
 * registration and then abandons it.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { AuthorizationSession } from "@deepseek-ai/dsh-authorization";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { resolveConfig } from "../src/host/config";
import { apply } from "../src/host/index";
import { oauthFlow } from "../src/host/oauth/flow";
import { extractor, formatDuration } from "../src/host/presentation/extract";
import { parseGists } from "../src/host/presentation/gist";
import { RuntimeState } from "../src/host/state";
import { Grant } from "../src/host/store/grant";
import { presentTool } from "../src/host/tools/present";
import { asPresentation } from "../src/shared/presentation";
import { issueTypeTone, priorityTone } from "../src/shared/tone";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

const records = new Map<string, unknown>();
const registered = {
	commands: [] as unknown[],
	flows: [] as unknown[],
	routes: [] as unknown[],
};

/**
 * The real store refuses a payload JSON cannot represent, so this fake refuses
 * it too: an `undefined` field must fail here rather than in a user's profile.
 */
function assertJsonRepresentable(record: unknown): unknown {
	const walk = (value: unknown, path: string): void => {
		if (value === undefined) throw new Error(`record ${path} holds undefined`);

		if (typeof value === "function" || typeof value === "symbol")
			throw new Error(`record ${path} holds a ${typeof value}`);

		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				walk(item, `${path}[${index}]`);
			});

			return;
		}

		if (value !== null && typeof value === "object")
			for (const [key, item] of Object.entries(value))
				walk(item, `${path}.${key}`);
	};

	walk(record, "payload");

	const roundTripped: unknown = JSON.parse(JSON.stringify(record));
	if (JSON.stringify(roundTripped) !== JSON.stringify(record))
		throw new Error("record payload does not survive a JSON round trip");

	return roundTripped;
}

/** A harness context with just enough surface for this plugin. */
function fakeContext(): Context {
	return {
		logger: {
			info: (...args: unknown[]) => console.log("  log:", ...args),
			warn: (...args: unknown[]) => console.log("  warn:", ...args),
		},
		tools: { register: () => () => {} },
		credentials: {
			readRecord: async (key: string) => records.get(key),
			modifyRecord: async (
				key: string,
				mutate: (current: unknown) => Promise<unknown>,
			) => {
				const next = await mutate(records.get(key));
				if (next === undefined) return records.get(key);
				records.set(key, assertJsonRepresentable(next));

				return next;
			},
			deleteRecord: async (key: string) => records.delete(key),
		},
		commands: {
			register: (command: unknown) => registered.commands.push(command),
		},
		authorization: {
			registerFlow: (flow: unknown) => {
				registered.flows.push(flow);

				return () => {};
			},
			cancel: () => {},
		},
		get: (name: string) =>
			name === "webServer"
				? {
						register: (route: unknown) => {
							registered.routes.push(route);

							return () => {};
						},
					}
				: undefined,
		effect: (callback: () => unknown) => {
			callback();
		},
	} as unknown as Context;
}

/** Drive one sign-in attempt up to the point where a human is needed. */
async function driveFlow(ctx: Context, endpoint: string): Promise<void> {
	console.log(`\n=== ${endpoint} ===`);

	const config = resolveConfig({ endpoint, redirectPort: 8143 });
	const controller = new AbortController();
	let notify: { message: string; url?: string } | undefined;

	const session = {
		method: "oauth",
		signal: controller.signal,
		notify: (notice: { message: string; url?: string }) => {
			notify = notice;
		},
		prompt: () => Promise.reject(new Error("no prompts expected")),
		commit: async (record: unknown) => {
			records.set(Grant.CREDENTIAL_KEY, assertJsonRepresentable(record));
		},
	} as unknown as AuthorizationSession;

	const running = oauthFlow
		.run(ctx, session, config)
		.catch((error: unknown) => error);

	for (let waited = 0; waited < 60 && notify === undefined; waited += 1)
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});

	if (notify === undefined) {
		check("the flow publishes an authorize URL", false);
		await running;

		return;
	}

	const authorize = new URL(notify.url ?? "");
	const params = authorize.searchParams;

	check("authorize host resolved", authorize.host !== "", authorize.host);
	check(
		"client registered dynamically",
		typeof params.get("client_id") === "string",
	);
	check("PKCE challenge sent", params.get("code_challenge_method") === "S256");
	check("resource parameter sent", params.get("resource") === endpoint);
	check(
		"scopes negotiated",
		(params.get("scope") ?? "").includes("offline_access"),
		params.get("scope") ?? "",
	);

	// The consent page must render for this exact client and redirect URI.
	const page = await fetch(notify.url ?? "");
	check(
		"authorize endpoint accepts the request",
		page.status < 400,
		`HTTP ${page.status}`,
	);

	// The loopback listener must be live and must reject a forged state.
	const redirect = new URL(params.get("redirect_uri") ?? "");
	const forged = await fetch(`${redirect.href}?code=forged&state=wrong`);
	check(
		"callback rejects a forged state",
		forged.status === 400,
		`HTTP ${forged.status}`,
	);

	controller.abort();
	const outcome = await running;
	check(
		"cancellation settles the attempt",
		outcome instanceof Error,
		String(outcome),
	);

	// The registration it wrote must be readable as a real grant.
	const grant = await Grant.read(ctx);
	check(
		"the stored registration is rehydrated",
		typeof grant?.isSignedIn === "function",
	);
	check("an unfinished grant is not signed in", grant?.isSignedIn() === false);
}

const ctx = fakeContext();

apply(ctx, { endpoint: resolveConfig(undefined).endpoint });
check("apply registers one authorization flow", registered.flows.length === 1);
check(
	"apply registers the /atlassian command",
	registered.commands.length === 1,
);
check("apply registers the loopback API route", registered.routes.length === 1);

// A grant read back from the store is plain JSON, not a class instance: this is
// the shape the credential store hands to every caller, so it must still work.
const rehydrated = Grant.from({
	version: 1,
	accessToken: "token",
	expiresAt: Date.now() + 60_000,
});
check("Grant.from rebuilds an instance", rehydrated?.isSignedIn() === true);
check("Grant.from tolerates a missing payload", Grant.from(null) === undefined);
check(
	"Grant.from tolerates a foreign payload",
	Grant.from(undefined) === undefined,
);

// The card is rendered from a record the browser validates; a payload this
// version cannot read must be skipped rather than drawn wrongly.
check(
	"a well-formed presentation is accepted",
	asPresentation({
		callId: "call-1",
		title: "План на день",
		layout: "compact",
		items: [
			{ kind: "issue", issue: { key: "DEV-1", summary: "One" } },
			{ kind: "page", page: { id: "42", title: "Notes" } },
		],
	})?.items.length === 2,
);
check(
	"an unknown layout falls back to a list",
	asPresentation({
		callId: "c",
		layout: "fancy",
		items: [{ kind: "issue", issue: { key: "D-1" } }],
	})?.layout === "list",
);
check(
	"a foreign record is ignored",
	asPresentation({ some: "other" }) === undefined,
);
check(
	"a record without items is ignored",
	asPresentation({ callId: "c", items: [] }) === undefined,
);
check(
	"an unreadable item is dropped, not rendered",
	asPresentation({
		callId: "c",
		items: [
			{ kind: "issue", issue: {} },
			{ kind: "page", page: { title: "ok" } },
		],
	})?.items.length === 1,
);
check(
	"a card says how many items matched",
	asPresentation({
		callId: "c",
		layout: "list",
		total: 42,
		items: [{ kind: "issue", issue: { key: "D-1" } }],
	})?.total === 42,
);
check(
	"a total that adds nothing is dropped",
	asPresentation({
		callId: "c",
		total: 1,
		items: [{ kind: "issue", issue: { key: "D-1" } }],
	})?.total === undefined,
);

// An estimate arrives as seconds or as Jira's own words; the card shows either.
check("a day of estimate reads as a day", formatDuration(28_800) === "1d");
check(
	"an hours-and-minutes estimate keeps both",
	formatDuration(3 * 3600 + 1800) === "3h 30m",
);
check("a sub-hour estimate reads in minutes", formatDuration(2700) === "45m");
check("no estimate is not a zero estimate", formatDuration(0) === undefined);

// The sentences come back from a model, so the reader must survive its habits.
const parsed = parseGists(
	"Here you go:\n```\n1: Починить баннер\n2. Собрать статистику\n- 3) Третья\n",
	3,
);
check(
	"numbered sentences are read out of an answer",
	parsed[0] === "Починить баннер" && parsed[1] === "Собрать статистику",
	String(parsed),
);
check("a bulleted number still counts", parsed[2] === "Третья", String(parsed));
check(
	"an out-of-range number is ignored",
	parseGists("9: nope", 2).every((item) => item === undefined),
);
check(
	"a second answer for one item does not overwrite the first",
	parseGists("1: first\n1: second", 1)[0] === "first",
);

// Colour is a claim about meaning, so an unknown name stays neutral.
check("a bug is red", issueTypeTone("Bug") === "danger");
check("a Russian epic is still an epic", issueTypeTone("Эпик") === "solid");
check("an unknown type is neutral", issueTypeTone("Mystery") === "neutral");
check("a missing type is neutral", issueTypeTone(undefined) === "neutral");
check("a blocker is red", priorityTone("P1") === "danger");
check("a normal priority is quiet", priorityTone("P3") === "quiet");
// A Jira scheme may spell its priorities with Cyrillic lookalikes: "Р3".
check(
	"a Cyrillic priority still reads as a priority",
	priorityTone("Р4") === "quiet",
);
check("an unknown priority is neutral", priorityTone("??") === "neutral");
check("a localized bug type is red too", issueTypeTone("Баг") === "danger");
check("a localized task type is blue", issueTypeTone("Задача") === "info");

// One MCP search result, as Atlassian sends it: JSON inside a text block.
const searchPayload = {
	content: [
		{
			type: "text",
			text: JSON.stringify({
				total: 42,
				issues: [
					{
						key: "DEV-7",
						fields: {
							summary: "Cookie banner",
							status: { name: "In Progress" },
							assignee: { displayName: "Kirill" },
							priority: { name: "P2" },
							issuetype: { name: "Bug" },
							timetracking: { originalEstimate: "3d 4h" },
							description: {
								type: "doc",
								version: 1,
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "Нужно починить" }],
									},
									{
										type: "paragraph",
										content: [{ type: "text", text: "баннер cookie" }],
									},
								],
							},
						},
					},
				],
			}),
		},
	],
};

const site = "https://acme.atlassian.net";
const withBodies = extractor.extract({
	tool: "searchJiraIssuesUsingJql",
	args: { jql: "project = DEV" },
	value: searchPayload,
	siteUrl: site,
	bodies: true,
});
const card = withBodies.issues[0];

check("a Jira search is recognized", withBodies.kind === "jira-issues");
check("the match count is read from the payload", withBodies.total === 42);
check(
	"the estimate is kept",
	card?.estimate === "3d 4h",
	String(card?.estimate),
);
check("the type is kept", card?.type === "Bug");
check(
	"an ADF description is flattened for the summary pass",
	card?.rawText?.includes("Нужно починить") === true &&
		card?.rawText?.includes("баннер cookie") === true,
	String(card?.rawText),
);
check(
	"a learned site URL gives every issue a link",
	card?.url === `${site}/browse/DEV-7`,
	String(card?.url),
);

const withoutBodies = extractor.extract({
	tool: "searchJiraIssuesUsingJql",
	args: {},
	value: searchPayload,
	siteUrl: site,
});
check(
	"the raw description is collected only when asked for",
	withoutBodies.issues[0]?.rawText === undefined,
);

const secondsOnly = extractor.extract({
	tool: "getJiraIssue",
	args: {},
	value: {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					key: "DEV-8",
					fields: { timeoriginalestimate: 28_800 },
				}),
			},
		],
	},
	siteUrl: undefined,
});
check(
	"a raw seconds estimate is rendered",
	secondsOnly.issues[0]?.estimate === "1d",
	String(secondsOnly.issues[0]?.estimate),
);
check(
	"without a site URL an issue has no link",
	secondsOnly.issues[0]?.url === undefined,
);

// A Confluence search answers with a site-relative URL, an HTML-ish excerpt,
// and the page again nested inside the result: one card, one absolute link.
const cqlPayload = {
	content: [
		{
			type: "text",
			text: JSON.stringify({
				totalSize: 712,
				size: 1,
				results: [
					{
						title: "Обзор",
						url: "/spaces/~123/overview",
						excerpt: "<p>Поздоровайтесь &amp; расскажите о себе</p>",
						content: {
							id: "988676219",
							type: "page",
							title: "Обзор",
							_links: {
								webui: "/spaces/~123/overview",
								self: `${site}/wiki/rest/api/content/988676219`,
							},
						},
					},
				],
			}),
		},
	],
};

const found = extractor.extract({
	tool: "searchConfluenceUsingCql",
	args: { cql: "type = page" },
	value: cqlPayload,
	siteUrl: site,
	bodies: true,
});

check("a Confluence search is recognized", found.kind === "confluence-pages");
check("a Confluence search reports its total", found.total === 712);
check(
	"a page nested inside its own search result is not drawn twice",
	found.pages.length === 1,
	String(found.pages.length),
);
check(
	"a site-relative page path is resolved against the wiki",
	found.pages[0]?.url === `${site}/wiki/spaces/~123/overview`,
	String(found.pages[0]?.url),
);
check(
	"an HTML snippet becomes the text to summarize",
	found.pages[0]?.rawText === "Поздоровайтесь & расскажите о себе",
	String(found.pages[0]?.rawText),
);

// The whole card pipeline, with both the MCP bridge and the model absent: the
// tool must still resolve, project and record a card that carries no raw text.
const calls: { name: string; args: Record<string, unknown> }[] = [];
const state = new RuntimeState();
state.cloudId = "cloud-1";
state.siteUrl = site;
state.client = {
	callTool: async (request: {
		name: string;
		arguments: Record<string, unknown>;
	}) => {
		calls.push({ name: request.name, args: request.arguments });

		return request.name === "searchJiraIssuesUsingJql"
			? searchPayload
			: cqlPayload;
	},
} as unknown as RuntimeState["client"];

const tool = presentTool.create(ctx, state);
const outcome = (await tool.execute(
	{ jql: "project = DEV", title: "План на день" },
	{
		callId: "call-1",
		signal: new AbortController().signal,
	} as unknown as ToolRunContext,
)) as { shown: number; summary: string; presentation: unknown };

const recorded = asPresentation(outcome.presentation);
const row = recorded?.items[0];
const fields = calls[0]?.args.fields;

check(
	"the tool resolves through the MCP bridge",
	calls[0]?.name === "searchJiraIssuesUsingJql",
);
check(
	"the card asks for the description it will compress",
	Array.isArray(fields) && fields.includes("description"),
);
check("the recorded card keeps its title", recorded?.title === "План на день");
check("one item is a single card", recorded?.layout === "single");
check("the recorded card counts what matched", recorded?.total === 42);
check(
	"the recorded card links to the issue",
	row?.kind === "issue" && row.issue.url === `${site}/browse/DEV-7`,
);
check(
	"the recorded card keeps the estimate",
	row?.kind === "issue" && row.issue.estimate === "3d 4h",
);
check(
	"no raw description reaches the recorded card",
	row?.kind === "issue" && !("rawText" in row.issue),
);
check(
	"the model is told what the card shows",
	outcome.summary.includes("План на день"),
);

await driveFlow(ctx, "https://mcp.atlassian.com/v1/mcp");
await driveFlow(ctx, "https://mcp.atlassian.com/v2/mcp");

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

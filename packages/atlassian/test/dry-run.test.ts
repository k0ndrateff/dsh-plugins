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

import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { AuthorizationSession } from "@deepseek-ai/dsh-authorization";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { IntegrationAuth, RuntimeState } from "dsh-integration-host";
import {
	AuthorizationFlow,
	Grant,
	GrantStore,
	type McpBridge,
} from "dsh-mcp-oauth";
import { atlassianAuthSpec } from "../src/host/auth";
import { atlassianProfile, resolveConfig } from "../src/host/config";
import { apply } from "../src/host/index";
import { PanelApi } from "../src/host/panels/panel";
import { extractor, formatDuration } from "../src/host/presentation/extract";
import { parseGists } from "../src/host/presentation/gist";
import { SiteFacts } from "../src/host/store/site";
import { createApiHandler } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import { asPanelData, asPanelTarget } from "../src/shared/panel";
import { asPresentation } from "../src/shared/presentation";
import type { AtlassianStatus } from "../src/shared/status";
import { issueTypeTone, priorityTone } from "../src/shared/tone";

const records = new Map<string, unknown>();
const registered = {
	commands: [] as unknown[],
	flows: [] as unknown[],
	routes: [] as unknown[],
	digestSources: [] as { blocks: { id: string }[] }[],
	correlationSources: [] as { resolves: string[] }[],
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

/** A bridge that answers from one function, for the tool and panel tests. */
function fakeBridge(
	call: (name: string, args: Record<string, unknown>) => unknown,
): McpBridge {
	return {
		callTool: async (name: string, args: Record<string, unknown>) =>
			call(name, args),
	} as unknown as McpBridge;
}

/** The record key this plugin owns. */
const CREDENTIAL_KEY = "dsh-atlassian/mcp";

/** A grant store over the fake credential store. */
function fakeStore(ctx: Context): GrantStore {
	return new GrantStore(ctx, CREDENTIAL_KEY);
}

/** A harness context with just enough surface for this plugin. */
function fakeContext(): Context {
	const fake = {
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
		// The route waits for this service; the fake answers as the harness does
		// once it is there, which is what a dry-run cares about.
		inject: (deps: readonly string[], callback: (scoped: unknown) => void) => {
			callback({
				...fake,
				...(deps.includes("digestSources")
					? {
							digestSources: {
								register: (source: { blocks: { id: string }[] }) => {
									registered.digestSources.push(source);

									return () => {};
								},
							},
						}
					: {}),
				...(deps.includes("correlationSources")
					? {
							correlationSources: {
								register: (source: { resolves: string[] }) => {
									registered.correlationSources.push(source);

									return () => {};
								},
							},
						}
					: {}),
			});

			return () => {};
		},
		effect: (callback: () => unknown) => {
			callback();
		},
	};

	return fake as unknown as Context;
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
			records.set(CREDENTIAL_KEY, assertJsonRepresentable(record));
		},
	} as unknown as AuthorizationSession;

	const running = new AuthorizationFlow(
		atlassianProfile(config),
		fakeStore(ctx),
	)
		.run(ctx, session)
		.catch((error: unknown) => error);

	// The flow discovers an authorization server and registers a client before it
	// publishes anything, and both are live calls: a slow minute is not a failure.
	for (let waited = 0; waited < 300 && notify === undefined; waited += 1)
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});

	if (notify === undefined) {
		expect(false, "the flow publishes an authorize URL").toBe(true);
		await running;

		return;
	}

	const authorize = new URL(notify.url ?? "");
	const params = authorize.searchParams;

	expect(
		authorize.host !== "",
		`authorize host resolved — ${authorize.host}`,
	).toBe(true);
	expect(
		typeof params.get("client_id") === "string",
		"client registered dynamically",
	).toBe(true);
	expect(
		params.get("code_challenge_method") === "S256",
		"PKCE challenge sent",
	).toBe(true);
	expect(params.get("resource") === endpoint, "resource parameter sent").toBe(
		true,
	);
	expect(
		(params.get("scope") ?? "").includes("offline_access"),
		`scopes negotiated — ${params.get("scope") ?? ""}`,
	).toBe(true);

	// The consent page must render for this exact client and redirect URI.
	const page = await fetch(notify.url ?? "");
	expect(
		page.status < 400,
		`authorize endpoint accepts the request — ${`HTTP ${page.status}`}`,
	).toBe(true);

	// The loopback listener must be live and must reject a forged state.
	const redirect = new URL(params.get("redirect_uri") ?? "");
	const forged = await fetch(`${redirect.href}?code=forged&state=wrong`);
	expect(
		forged.status === 400,
		`callback rejects a forged state — ${`HTTP ${forged.status}`}`,
	).toBe(true);

	controller.abort();
	const outcome = await running;
	expect(
		outcome instanceof Error,
		`cancellation settles the attempt — ${String(outcome)}`,
	).toBe(true);

	// The registration it wrote must be readable as a real grant.
	const grant = await fakeStore(ctx).read();
	expect(
		typeof grant?.isSignedIn === "function",
		"the stored registration is rehydrated",
	).toBe(true);
	expect(
		grant?.isSignedIn() === false,
		"an unfinished grant is not signed in",
	).toBe(true);
}

const ctx = fakeContext();

test("the host against recorded payloads", async () => {
	apply(ctx, { endpoint: resolveConfig(undefined).endpoint });
	expect(
		registered.flows.length === 1,
		"apply registers one authorization flow",
	).toBe(true);
	expect(
		registered.commands.length === 1,
		"apply registers the /atlassian command",
	).toBe(true);
	expect(
		registered.routes.length === 1,
		"apply registers the loopback API route",
	).toBe(true);
	expect(
		registered.digestSources.length === 1 &&
			registered.digestSources[0]?.blocks.map((block) => block.id).join(",") ===
				"jira-active,jira-queued",
		`apply offers the digest its Jira blocks — ${registered.digestSources
			.flatMap((source) => source.blocks.map((block) => block.id))
			.join(",")}`,
	).toBe(true);
	expect(
		registered.correlationSources.length === 1 &&
			registered.correlationSources[0]?.resolves.join(",") === "task",
		`and offers a chain the Jira issue a ticket key names — ${registered.correlationSources
			.flatMap((source) => source.resolves)
			.join(",")}`,
	).toBe(true);

	// A grant read back from the store is plain JSON, not a class instance: this is
	// the shape the credential store hands to every caller, so it must still work.
	const rehydrated = Grant.from({
		version: 1,
		accessToken: "token",
		expiresAt: Date.now() + 60_000,
	});
	expect(
		rehydrated?.isSignedIn() === true,
		"Grant.from rebuilds an instance",
	).toBe(true);
	expect(
		Grant.from(null) === undefined,
		"Grant.from tolerates a missing payload",
	).toBe(true);

	// The card is rendered from a record the browser validates; a payload this
	// version cannot read must be skipped rather than drawn wrongly.
	expect(
		asPresentation({
			callId: "call-1",
			title: "План на день",
			layout: "compact",
			items: [
				{ kind: "issue", issue: { key: "DEV-1", summary: "One" } },
				{ kind: "page", page: { id: "42", title: "Notes" } },
			],
		})?.items.length === 2,
		"a well-formed presentation is accepted",
	).toBe(true);
	expect(
		asPresentation({
			callId: "c",
			layout: "fancy",
			items: [{ kind: "issue", issue: { key: "D-1" } }],
		})?.layout === "list",
		"an unknown layout falls back to a list",
	).toBe(true);
	expect(
		asPresentation({ some: "other" }) === undefined,
		"a foreign record is ignored",
	).toBe(true);
	expect(
		asPresentation({ callId: "c", items: [] }) === undefined,
		"a record without items is ignored",
	).toBe(true);
	expect(
		asPresentation({
			callId: "c",
			items: [
				{ kind: "issue", issue: {} },
				{ kind: "page", page: { title: "ok" } },
			],
		})?.items.length === 1,
		"an unreadable item is dropped, not rendered",
	).toBe(true);
	expect(
		asPresentation({
			callId: "c",
			layout: "list",
			total: 42,
			items: [{ kind: "issue", issue: { key: "D-1" } }],
		})?.total === 42,
		"a card says how many items matched",
	).toBe(true);
	expect(
		asPresentation({
			callId: "c",
			total: 1,
			items: [{ kind: "issue", issue: { key: "D-1" } }],
		})?.total === undefined,
		"a total that adds nothing is dropped",
	).toBe(true);

	// An estimate arrives as seconds or as Jira's own words; the card shows either.
	expect(
		formatDuration(28_800) === "1d",
		"a day of estimate reads as a day",
	).toBe(true);
	expect(
		formatDuration(3 * 3600 + 1800) === "3h 30m",
		"an hours-and-minutes estimate keeps both",
	).toBe(true);
	expect(
		formatDuration(2700) === "45m",
		"a sub-hour estimate reads in minutes",
	).toBe(true);
	expect(
		formatDuration(0) === undefined,
		"no estimate is not a zero estimate",
	).toBe(true);

	// The sentences come back from a model, so the reader must survive its habits.
	const parsed = parseGists(
		"Here you go:\n```\n1: Починить баннер\n2. Собрать статистику\n- 3) Третья\n",
		3,
	);
	expect(
		parsed[0] === "Починить баннер" && parsed[1] === "Собрать статистику",
		`numbered sentences are read out of an answer — ${String(parsed)}`,
	).toBe(true);
	expect(
		parsed[2] === "Третья",
		`a bulleted number still counts — ${String(parsed)}`,
	).toBe(true);
	expect(
		parseGists("9: nope", 2).every((item) => item === undefined),
		"an out-of-range number is ignored",
	).toBe(true);
	expect(
		parseGists("1: first\n1: second", 1)[0] === "first",
		"a second answer for one item does not overwrite the first",
	).toBe(true);

	// Colour is a claim about meaning, so an unknown name stays neutral.
	expect(issueTypeTone("Bug") === "danger", "a bug is red").toBe(true);
	expect(
		issueTypeTone("Эпик") === "solid",
		"a Russian epic is still an epic",
	).toBe(true);
	expect(
		issueTypeTone("Mystery") === "neutral",
		"an unknown type is neutral",
	).toBe(true);
	expect(
		issueTypeTone(undefined) === "neutral",
		"a missing type is neutral",
	).toBe(true);
	expect(priorityTone("P1") === "danger", "a blocker is red").toBe(true);
	expect(priorityTone("P3") === "quiet", "a normal priority is quiet").toBe(
		true,
	);
	// A Jira scheme may spell its priorities with Cyrillic lookalikes: "Р3".
	expect(
		priorityTone("Р4") === "quiet",
		"a Cyrillic priority still reads as a priority",
	).toBe(true);
	expect(
		priorityTone("??") === "neutral",
		"an unknown priority is neutral",
	).toBe(true);
	expect(
		issueTypeTone("Баг") === "danger",
		"a localized bug type is red too",
	).toBe(true);
	expect(
		issueTypeTone("Задача") === "info",
		"a localized task type is blue",
	).toBe(true);

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

	expect(withBodies.kind === "jira-issues", "a Jira search is recognized").toBe(
		true,
	);
	expect(
		withBodies.total === 42,
		"the match count is read from the payload",
	).toBe(true);
	expect(
		card?.estimate === "3d 4h",
		`the estimate is kept — ${String(card?.estimate)}`,
	).toBe(true);
	expect(card?.type === "Bug", "the type is kept").toBe(true);
	expect(
		card?.rawText?.includes("Нужно починить") === true &&
			card?.rawText?.includes("баннер cookie") === true,
		`an ADF description is flattened for the summary pass — ${String(card?.rawText)}`,
	).toBe(true);
	expect(
		card?.url === `${site}/browse/DEV-7`,
		`a learned site URL gives every issue a link — ${String(card?.url)}`,
	).toBe(true);

	const withoutBodies = extractor.extract({
		tool: "searchJiraIssuesUsingJql",
		args: {},
		value: searchPayload,
		siteUrl: site,
	});
	expect(
		withoutBodies.issues[0]?.rawText === undefined,
		"the raw description is collected only when asked for",
	).toBe(true);

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
	expect(
		secondsOnly.issues[0]?.estimate === "1d",
		`a raw seconds estimate is rendered — ${String(secondsOnly.issues[0]?.estimate)}`,
	).toBe(true);
	expect(
		secondsOnly.issues[0]?.url === undefined,
		"without a site URL an issue has no link",
	).toBe(true);

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

	expect(
		found.kind === "confluence-pages",
		"a Confluence search is recognized",
	).toBe(true);
	expect(found.total === 712, "a Confluence search reports its total").toBe(
		true,
	);
	expect(
		found.pages.length === 1,
		`a page nested inside its own search result is not drawn twice — ${String(found.pages.length)}`,
	).toBe(true);
	expect(
		found.pages[0]?.url === `${site}/wiki/spaces/~123/overview`,
		`a site-relative page path is resolved against the wiki — ${String(found.pages[0]?.url)}`,
	).toBe(true);
	expect(
		found.pages[0]?.rawText === "Поздоровайтесь & расскажите о себе",
		`an HTML snippet becomes the text to summarize — ${String(found.pages[0]?.rawText)}`,
	).toBe(true);

	// The whole card pipeline, with both the MCP bridge and the model absent: the
	// tool must still resolve, project and record a card that carries no raw text.
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const state = new RuntimeState<SiteFacts>();
	state.facts = new SiteFacts({ cloudId: "cloud-1", siteUrl: site });
	const cardBridge = fakeBridge((name, args) => {
		calls.push({ name, args });

		return name === "searchJiraIssuesUsingJql" ? searchPayload : cqlPayload;
	});

	const tool = presentTool.create({ ctx, bridge: cardBridge, state });
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

	expect(
		calls[0]?.name === "searchJiraIssuesUsingJql",
		"the tool resolves through the MCP bridge",
	).toBe(true);
	expect(
		Array.isArray(fields) && fields.includes("description"),
		"the card asks for the description it will compress",
	).toBe(true);
	expect(
		recorded?.title === "План на день",
		"the recorded card keeps its title",
	).toBe(true);
	expect(recorded?.layout === "single", "one item is a single card").toBe(true);
	expect(recorded?.total === 42, "the recorded card counts what matched").toBe(
		true,
	);
	expect(
		row?.kind === "issue" && row.issue.url === `${site}/browse/DEV-7`,
		"the recorded card links to the issue",
	).toBe(true);
	expect(
		row?.kind === "issue" && row.issue.estimate === "3d 4h",
		"the recorded card keeps the estimate",
	).toBe(true);
	expect(
		row?.kind === "issue" && !("rawText" in row.issue),
		"no raw description reaches the recorded card",
	).toBe(true);
	expect(
		outcome.summary.includes("План на день"),
		"the model is told what the card shows",
	).toBe(true);

	const emptyTool = presentTool.create({
		ctx,
		bridge: fakeBridge(() => mcp({ issues: [], isLast: true })),
		state,
	});
	const empty = (await emptyTool.execute(
		{ jql: "project = DEV AND status = Done" },
		{
			callId: "call-empty",
			signal: new AbortController().signal,
		} as unknown as ToolRunContext,
	)) as { shown: number; summary: string; presentation: { items: unknown[] } };

	expect(
		empty.shown === 0 && empty.summary.includes("No issues or pages matched"),
		`an empty JQL is an answer, not a failed call — ${empty.summary}`,
	).toBe(true);
	expect(
		empty.presentation.items.length === 0,
		`and it records no card for the client to draw — ${JSON.stringify(empty.presentation)}`,
	).toBe(true);

	// --- The side panel ------------------------------------------------------
	// The panel is the only writer in this plugin, so its half of the test drives
	// both directions: what the host loads for a panel, and what the routes accept.

	/** One MCP result, as the server sends it: JSON inside a text block. */
	function mcp(value: unknown): unknown {
		return { content: [{ type: "text", text: JSON.stringify(value) }] };
	}

	/** A route request the handler can read, without a socket under it. */
	function fakeRequest(
		method: string,
		url: string,
		body?: unknown,
	): IncomingMessage {
		const chunks =
			body === undefined ? [] : [Buffer.from(JSON.stringify(body))];

		return {
			method,
			url,
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
	}

	/** A route response that records what the handler answered. */
	function fakeResponse(): {
		response: ServerResponse;
		read: () => { status: number; body: unknown };
	} {
		let status = 0;
		let payload = "";

		return {
			response: {
				writeHead: (code: number) => {
					status = code;
				},
				end: (text?: string) => {
					payload = text ?? "";
				},
			} as unknown as ServerResponse,
			read: () => ({
				status,
				body: payload === "" ? undefined : JSON.parse(payload),
			}),
		};
	}

	const panelIssue = {
		id: "43753",
		key: "DEV-6471",
		fields: {
			summary: "Убрать base64-PNG из SVG-иконок",
			issuetype: { name: "Задача" },
			status: { name: "Release Testing" },
			priority: { name: "Р2" },
			assignee: { accountId: "acc-1", displayName: "Egor Kain" },
			reporter: { displayName: "Don Cook" },
			duedate: "2026-10-30",
			labels: ["B2C", "Frontend"],
			updated: "2026-10-19T18:21:23.514Z",
			timetracking: { originalEstimate: "1ч", originalEstimateSeconds: 3600 },
			description: "Требуется убрать base64-PNG из иконок.",
			comment: {
				comments: [
					{
						author: { displayName: "Azaliia Kh" },
						created: "2026-10-16T15:58:09.328+0200",
						body: "заменили цвет текста",
					},
				],
			},
		},
	};

	const panelState = new RuntimeState<SiteFacts>();
	panelState.facts = new SiteFacts({ cloudId: "cloud-1", siteUrl: site });

	const panelWrite: { name: string; args: Record<string, unknown> }[] = [];
	let failTransitions = false;

	const panelBridge = fakeBridge((name, args) => {
		panelWrite.push({ name, args });

		switch (name) {
			case "getJiraIssue":
				return mcp(panelIssue);
			case "getTransitionsForJiraIssue":
				if (failTransitions) throw new Error("no transitions for you");
				return mcp({
					transitions: [
						{
							id: "11",
							name: "Ready on Preview",
							to: { name: "Ready on Preview" },
							isAvailable: true,
							hasScreen: false,
						},
						{ id: "12", name: "Done", isAvailable: false, hasScreen: true },
					],
				});
			case "lookupJiraAccountId":
				return mcp({
					data: {
						users: {
							users: [
								{ accountId: "acc-1", displayName: "Kirill" },
								{ accountId: "", displayName: "nameless" },
							],
						},
					},
				});
			case "getConfluencePage":
				return mcp({ id: "988676219", title: "Обзор", body: "# Привет" });
			case "getConfluencePageFooterComments":
				return mcp({
					results: [
						{
							body: "Спасибо, поправили",
							author: { displayName: "Ada Lovelace" },
						},
					],
				});
			case "atlassianUserInfo":
				return mcp({ account_id: "acc-me", name: "Ada Lovelace" });
			default:
				return mcp({});
		}
	});

	const panel = new PanelApi({ bridge: panelBridge, state: panelState });
	const loaded = await panel.issue("DEV-6471");

	expect(loaded.key === "DEV-6471", "the panel loads the issue").toBe(true);
	expect(
		loaded.type === "Задача" && loaded.priority === "Р2",
		"the panel keeps the localized type and priority",
	).toBe(true);
	expect(
		loaded.url === `${site}/browse/DEV-6471`,
		"the panel links to the issue",
	).toBe(true);
	expect(
		loaded.assignee?.name === "Egor Kain",
		"the panel shows the assignee",
	).toBe(true);
	expect(loaded.estimate === "1ч", "the panel shows Jira's own estimate").toBe(
		true,
	);
	expect(
		loaded.labels.length === 2 && loaded.due === "2026-10-30",
		"the panel shows the labels and the due date",
	).toBe(true);
	expect(
		loaded.description === "Требуется убрать base64-PNG из иконок.",
		`the panel shows the description as text — ${String(loaded.description)}`,
	).toBe(true);
	expect(
		loaded.comments[0]?.author === "Azaliia Kh" &&
			loaded.comments[0]?.body === "заменили цвет текста",
		"the panel shows the comment and who wrote it",
	).toBe(true);
	expect(
		loaded.transitions[1]?.needsFields === true &&
			loaded.transitions[1]?.available === false,
		"a transition that opens a screen is marked as one",
	).toBe(true);
	expect(
		loaded.transitions[0]?.name === "Ready on Preview" &&
			loaded.transitions[0]?.to === "Ready on Preview",
		"an ordinary transition is offered",
	).toBe(true);

	// A workflow the token cannot read must not cost the user the issue itself.
	failTransitions = true;
	const withoutTransitions = await panel.issue("DEV-6471");
	expect(
		withoutTransitions.key === "DEV-6471" &&
			withoutTransitions.transitions.length === 0,
		"a failed transition list still answers with the issue",
	).toBe(true);
	failTransitions = false;

	const people = await panel.people("Kir");
	expect(
		people.length === 1 && people[0]?.accountId === "acc-1",
		`the panel can find a person — ${String(people.length)}`,
	).toBe(true);

	const page = await panel.page("988676219");
	expect(
		page.title === "Обзор" && page.body === "# Привет",
		"the panel loads the page",
	).toBe(true);
	expect(
		page.url === `${site}/wiki/pages/viewpage.action?pageId=988676219`,
		`a page with no webui link still gets one — ${String(page.url)}`,
	).toBe(true);
	expect(
		page.comments[0]?.body === "Спасибо, поправили" &&
			page.comments[0]?.author === "Ada Lovelace",
		`the page shows its footer comments — ${JSON.stringify(page.comments)}`,
	).toBe(true);

	const me = await panel.me();
	expect(
		me?.accountId === "acc-me" && me.name === "Ada Lovelace",
		`the panel reads the account id in the identity endpoint's spelling — ${JSON.stringify(me)}`,
	).toBe(true);

	// The routes the browser half actually calls.
	const routeConfig = resolveConfig(undefined);
	const routeStore = fakeStore(ctx);
	const routeFlow = new AuthorizationFlow(
		atlassianProfile(routeConfig),
		routeStore,
	);
	const route = createApiHandler({
		auth: new IntegrationAuth<AtlassianStatus, SiteFacts>({
			ctx,
			config: routeConfig,
			state: panelState,
			store: routeStore,
			flow: routeFlow,
			bridge: panelBridge,
			spec: atlassianAuthSpec,
		}),
		panel,
	});

	const readIssue = fakeResponse();
	await route(
		fakeRequest("GET", "/dsh-atlassian/issue?key=DEV-6471"),
		readIssue.response,
	);
	const issueAnswer = readIssue.read();
	expect(
		issueAnswer.status === 200 &&
			asPanelData(issueAnswer.body)?.kind === "issue",
		`the issue route answers a readable document — ${`HTTP ${issueAnswer.status}`}`,
	).toBe(true);

	const readPage = fakeResponse();
	await route(
		fakeRequest("GET", "/dsh-atlassian/page?id=988676219"),
		readPage.response,
	);
	expect(
		asPanelData(readPage.read().body)?.kind === "page",
		"the page route answers a readable document",
	).toBe(true);

	const readPeople = fakeResponse();
	await route(
		fakeRequest("GET", "/dsh-atlassian/people?q=Kir"),
		readPeople.response,
	);
	expect(
		Array.isArray(readPeople.read().body),
		"the people route answers a list",
	).toBe(true);

	panelWrite.length = 0;
	const assign = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/assignee", {
			key: "DEV-6471",
			accountId: "acc-1",
		}),
		assign.response,
	);
	expect(
		panelWrite.some(
			(call) =>
				call.name === "editJiraIssue" &&
				(call.args.fields as { assignee?: { accountId?: string } }).assignee
					?.accountId === "acc-1",
		),
		"the assignee route writes the change",
	).toBe(true);
	expect(
		asPanelData(assign.read().body)?.kind === "issue",
		"the assignee route answers with the fresh issue",
	).toBe(true);

	const unassign = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/assignee", {
			key: "DEV-6471",
			accountId: null,
		}),
		unassign.response,
	);
	expect(
		panelWrite.some(
			(call) =>
				call.name === "editJiraIssue" &&
				(call.args.fields as { assignee?: unknown }).assignee === null,
		),
		"an explicit null clears the assignee",
	).toBe(true);

	const transition = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/transition", {
			key: "DEV-6471",
			transitionId: "11",
		}),
		transition.response,
	);
	expect(
		panelWrite.some(
			(call) =>
				call.name === "transitionJiraIssue" &&
				(call.args.transition as { id?: string }).id === "11",
		),
		"the transition route sends the transition id",
	).toBe(true);

	const missing = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/transition", { key: "DEV-6471" }),
		missing.response,
	);
	expect(
		missing.read().status === 400,
		`a write without its target is refused as a bad request, not a gateway — ${`HTTP ${missing.read().status}`}`,
	).toBe(true);

	// The panel's own validator: the browser half must not draw a document this
	// version cannot read.
	expect(
		asPanelTarget({ kind: "issue", key: "D-1" })?.kind === "issue" &&
			asPanelTarget({ kind: "page", id: "42", title: "T" })?.kind === "page",
		"a panel target is narrowed",
	).toBe(true);
	expect(
		asPanelTarget({ kind: "wiki" }) === undefined,
		"a foreign panel target is ignored",
	).toBe(true);
	expect(
		asPanelData({ kind: "issue", summary: "no key" }) === undefined,
		"a panel document without its identity is ignored",
	).toBe(true);
	expect(
		asPanelData({ kind: "issue", key: "D-1" })?.kind === "issue",
		"a panel document survives a missing optional field",
	).toBe(true);
});

const live = process.env.ATLASSIAN_LIVE === "1";

(live ? test : test.skip)(
	"the live OAuth discovery and consent redirect",
	async () => {
		await driveFlow(ctx, "https://mcp.atlassian.com/v1/mcp");
		await driveFlow(ctx, "https://mcp.atlassian.com/v2/mcp");
	},
	300_000,
);

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

/** One assertion in a dry-run scenario, with the label as its message. */
const check = (label: string, ok: boolean, detail = ""): void => {
	expect(ok, detail === "" ? label : `${label} — ${detail}`).toBe(true);
};

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
	const grant = await fakeStore(ctx).read();
	check(
		"the stored registration is rehydrated",
		typeof grant?.isSignedIn === "function",
	);
	check("an unfinished grant is not signed in", grant?.isSignedIn() === false);
}

const ctx = fakeContext();

test("the host against recorded payloads", async () => {
	apply(ctx, { endpoint: resolveConfig(undefined).endpoint });
	check(
		"apply registers one authorization flow",
		registered.flows.length === 1,
	);
	check(
		"apply registers the /atlassian command",
		registered.commands.length === 1,
	);
	check(
		"apply registers the loopback API route",
		registered.routes.length === 1,
	);
	check(
		"apply offers the digest its Jira blocks",
		registered.digestSources.length === 1 &&
			registered.digestSources[0]?.blocks.map((block) => block.id).join(",") ===
				"jira-active,jira-queued",
		registered.digestSources
			.flatMap((source) => source.blocks.map((block) => block.id))
			.join(","),
	);
	check(
		"and offers a chain the Jira issue a ticket key names",
		registered.correlationSources.length === 1 &&
			registered.correlationSources[0]?.resolves.join(",") === "task",
		registered.correlationSources
			.flatMap((source) => source.resolves)
			.join(","),
	);

	// A grant read back from the store is plain JSON, not a class instance: this is
	// the shape the credential store hands to every caller, so it must still work.
	const rehydrated = Grant.from({
		version: 1,
		accessToken: "token",
		expiresAt: Date.now() + 60_000,
	});
	check("Grant.from rebuilds an instance", rehydrated?.isSignedIn() === true);
	check(
		"Grant.from tolerates a missing payload",
		Grant.from(null) === undefined,
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
	check(
		"a bulleted number still counts",
		parsed[2] === "Третья",
		String(parsed),
	);
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

	check(
		"the tool resolves through the MCP bridge",
		calls[0]?.name === "searchJiraIssuesUsingJql",
	);
	check(
		"the card asks for the description it will compress",
		Array.isArray(fields) && fields.includes("description"),
	);
	check(
		"the recorded card keeps its title",
		recorded?.title === "План на день",
	);
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

	check(
		"an empty JQL is an answer, not a failed call",
		empty.shown === 0 && empty.summary.includes("No issues or pages matched"),
		empty.summary,
	);
	check(
		"and it records no card for the client to draw",
		empty.presentation.items.length === 0,
		JSON.stringify(empty.presentation),
	);

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

	check("the panel loads the issue", loaded.key === "DEV-6471");
	check(
		"the panel keeps the localized type and priority",
		loaded.type === "Задача" && loaded.priority === "Р2",
	);
	check(
		"the panel links to the issue",
		loaded.url === `${site}/browse/DEV-6471`,
	);
	check("the panel shows the assignee", loaded.assignee?.name === "Egor Kain");
	check("the panel shows Jira's own estimate", loaded.estimate === "1ч");
	check(
		"the panel shows the labels and the due date",
		loaded.labels.length === 2 && loaded.due === "2026-10-30",
	);
	check(
		"the panel shows the description as text",
		loaded.description === "Требуется убрать base64-PNG из иконок.",
		String(loaded.description),
	);
	check(
		"the panel shows the comment and who wrote it",
		loaded.comments[0]?.author === "Azaliia Kh" &&
			loaded.comments[0]?.body === "заменили цвет текста",
	);
	check(
		"a transition that opens a screen is marked as one",
		loaded.transitions[1]?.needsFields === true &&
			loaded.transitions[1]?.available === false,
	);
	check(
		"an ordinary transition is offered",
		loaded.transitions[0]?.name === "Ready on Preview" &&
			loaded.transitions[0]?.to === "Ready on Preview",
	);

	// A workflow the token cannot read must not cost the user the issue itself.
	failTransitions = true;
	const withoutTransitions = await panel.issue("DEV-6471");
	check(
		"a failed transition list still answers with the issue",
		withoutTransitions.key === "DEV-6471" &&
			withoutTransitions.transitions.length === 0,
	);
	failTransitions = false;

	const people = await panel.people("Kir");
	check(
		"the panel can find a person",
		people.length === 1 && people[0]?.accountId === "acc-1",
		String(people.length),
	);

	const page = await panel.page("988676219");
	check(
		"the panel loads the page",
		page.title === "Обзор" && page.body === "# Привет",
	);
	check(
		"a page with no webui link still gets one",
		page.url === `${site}/wiki/pages/viewpage.action?pageId=988676219`,
		String(page.url),
	);
	check(
		"the page shows its footer comments",
		page.comments[0]?.body === "Спасибо, поправили" &&
			page.comments[0]?.author === "Ada Lovelace",
		JSON.stringify(page.comments),
	);

	const me = await panel.me();
	check(
		"the panel reads the account id in the identity endpoint's spelling",
		me?.accountId === "acc-me" && me.name === "Ada Lovelace",
		JSON.stringify(me),
	);

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
	check(
		"the issue route answers a readable document",
		issueAnswer.status === 200 &&
			asPanelData(issueAnswer.body)?.kind === "issue",
		`HTTP ${issueAnswer.status}`,
	);

	const readPage = fakeResponse();
	await route(
		fakeRequest("GET", "/dsh-atlassian/page?id=988676219"),
		readPage.response,
	);
	check(
		"the page route answers a readable document",
		asPanelData(readPage.read().body)?.kind === "page",
	);

	const readPeople = fakeResponse();
	await route(
		fakeRequest("GET", "/dsh-atlassian/people?q=Kir"),
		readPeople.response,
	);
	check(
		"the people route answers a list",
		Array.isArray(readPeople.read().body),
	);

	panelWrite.length = 0;
	const assign = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/assignee", {
			key: "DEV-6471",
			accountId: "acc-1",
		}),
		assign.response,
	);
	check(
		"the assignee route writes the change",
		panelWrite.some(
			(call) =>
				call.name === "editJiraIssue" &&
				(call.args.fields as { assignee?: { accountId?: string } }).assignee
					?.accountId === "acc-1",
		),
	);
	check(
		"the assignee route answers with the fresh issue",
		asPanelData(assign.read().body)?.kind === "issue",
	);

	const unassign = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/assignee", {
			key: "DEV-6471",
			accountId: null,
		}),
		unassign.response,
	);
	check(
		"an explicit null clears the assignee",
		panelWrite.some(
			(call) =>
				call.name === "editJiraIssue" &&
				(call.args.fields as { assignee?: unknown }).assignee === null,
		),
	);

	const transition = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/transition", {
			key: "DEV-6471",
			transitionId: "11",
		}),
		transition.response,
	);
	check(
		"the transition route sends the transition id",
		panelWrite.some(
			(call) =>
				call.name === "transitionJiraIssue" &&
				(call.args.transition as { id?: string }).id === "11",
		),
	);

	const missing = fakeResponse();
	await route(
		fakeRequest("POST", "/dsh-atlassian/issue/transition", { key: "DEV-6471" }),
		missing.response,
	);
	check(
		"a write without its target is refused as a bad request, not a gateway",
		missing.read().status === 400,
		`HTTP ${missing.read().status}`,
	);

	// The panel's own validator: the browser half must not draw a document this
	// version cannot read.
	check(
		"a panel target is narrowed",
		asPanelTarget({ kind: "issue", key: "D-1" })?.kind === "issue" &&
			asPanelTarget({ kind: "page", id: "42", title: "T" })?.kind === "page",
	);
	check(
		"a foreign panel target is ignored",
		asPanelTarget({ kind: "wiki" }) === undefined,
	);
	check(
		"a panel document without its identity is ignored",
		asPanelData({ kind: "issue", summary: "no key" }) === undefined,
	);
	check(
		"a panel document survives a missing optional field",
		asPanelData({ kind: "issue", key: "D-1" })?.kind === "issue",
	);
});

const live = process.env.ATLASSIAN_LIVE === "1";

(live ? test : test.skip)(
	"the live OAuth discovery and consent redirect",
	async () => {
		await driveFlow(ctx, "https://mcp.atlassian.com/v1/mcp");
		await driveFlow(ctx, "https://mcp.atlassian.com/v2/mcp");
	},
);

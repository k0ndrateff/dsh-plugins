/**
 * `atlassian_present` — the tool behind a card in the conversation.
 *
 * It resolves what to show (by key or URL, by JQL, by page id or URL, or by
 * CQL), records one durable presentation for the turn, and answers the model
 * with a text summary. The card is presentation only: the model reads the text
 * result, and the record is what the browser half renders under the closing
 * prose.
 *
 * The tool resolves the cloud id itself when the plugin has learned it, so the
 * model does not have to thread that identifier through every call. A site the
 * plugin did not learn is never guessed silently: the summary says which site
 * answered and the card carries its cloud id, so the panel opens the same site.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolExecution } from "@deepseek-ai/dsh-tools";
import type { RuntimeState } from "dsh-integration-host";
import { nonEmptyString } from "dsh-integration-host/shape";
import {
	asRecord,
	type JsonValue,
	type McpBridge,
	mcpJson,
} from "dsh-mcp-oauth";
import type { AtlassianMeta, IssueCard, PageCard } from "../../shared/meta";
import type {
	AtlassianPresentation,
	PresentationItem,
	PresentationLayout,
	PresentationLayoutInput,
} from "../../shared/presentation";
import { extractor } from "../presentation/extract";
import { type Gist, modelRoute, summarizeGists } from "../presentation/gist";
import type { SiteFacts } from "../store/site";

/** What the tool needs from the plugin to resolve and record one card. */
export interface PresentDeps {
	readonly ctx: Context;
	readonly bridge: McpBridge;
	readonly state: RuntimeState<SiteFacts>;
}

/** One tool call's text answer, before it becomes blocks. */
interface PresentOutcome {
	readonly title: string | undefined;
	readonly layout: PresentationLayout;
	readonly items: readonly PresentationItem[];
	/** The server's match count, when it exceeds what the card shows. */
	readonly total: number | undefined;
	/** Requests that could not be resolved, with the reason the server gave. */
	readonly failed: readonly string[];
	/** Whether the server held back another page of search results. */
	readonly truncated: boolean;
	/** Requests left out because one card reads only {@link MAX_ITEMS}. */
	readonly dropped: number;
	/** The site the card was resolved on, when the plugin knew one. */
	readonly cloudId: string | undefined;
	/** That site's base URL, for the card's own note. */
	readonly siteUrl: string | undefined;
}

/** What one resolution pass found: card items and the count behind them. */
interface Found<Item> {
	readonly items: readonly Item[];
	/** The server's own match count, when it reported one. */
	readonly total: number | undefined;
	/** Whether the server named a next page. */
	readonly truncated?: boolean;
}

/** The arguments the model may send, after validation. */
interface PresentArgs {
	readonly title: string | undefined;
	readonly layout: PresentationLayoutInput | undefined;
	readonly cloudId: string | undefined;
	readonly issues: readonly string[];
	readonly pages: readonly string[];
	readonly jql: string | undefined;
	readonly cql: string | undefined;
	/** Values left out because one card reads only {@link MAX_ITEMS}. */
	readonly dropped: number;
}

/** Whether one search answer names another page. */
const hasMore = (value: unknown): boolean => {
	return mcpJson(value).some((root) => {
		const record = asRecord(root);

		return (
			record?.isLast === false ||
			(typeof record?.nextPageToken === "string" && record.nextPageToken !== "")
		);
	});
};

const stringList = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	return value.filter(
		(item): item is string => typeof item === "string" && item !== "",
	);
};

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** A Jira issue key as a key or as the `/browse/<key>` URL a user copies. */
const ISSUE_KEY = /(?:^|\/browse\/)([A-Z][A-Z0-9_]{0,9}-\d+)(?:$|[/?#])/u;

/** A Confluence page id as an id or as one of the URLs a user copies. */
const PAGE_ID = /(?:\/pages\/|[?&]pageId=)(\d+)(?:$|[/?#&])/u;

/**
 * The Jira issue key a value names.
 *
 * A user copies a browser URL, not a key, so both are accepted; a value that
 * names neither is passed through unchanged, and the server's own refusal then
 * reaches the model as the reason.
 * @param value - an issue key or a Jira URL.
 * @returns the key, or the input when it carries none.
 */
export const issueKeyOf = (value: string): string => {
	const trimmed = value.trim();

	return ISSUE_KEY.exec(trimmed)?.[1] ?? trimmed;
};

/**
 * The Confluence page id a value names.
 * @param value - a numeric page id or a Confluence URL.
 * @returns the id, or the input when it carries none.
 */
export const pageIdOf = (value: string): string => {
	const trimmed = value.trim();
	const fromUrl = PAGE_ID.exec(trimmed)?.[1];

	if (fromUrl !== undefined) return fromUrl;
	if (/^\d+$/u.test(trimmed)) return trimmed;

	return trimmed;
};

class PresentTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = "atlassian_present";

	/** Never put more than this many items on one card. */
	private readonly MAX_ITEMS = 25;

	/** Fields that make a card useful without making the call enormous. */
	private readonly ISSUE_FIELDS = [
		"summary",
		"status",
		"assignee",
		"priority",
		"issuetype",
		"timetracking",
		"timeoriginalestimate",
		// Read to write one sentence per issue, then dropped again: the recorded
		// card carries the sentence, never the description.
		"description",
	];

	/**
	 * Build the tool definition for one plugin instance.
	 */
	create = (deps: PresentDeps): ToolDefinition => ({
		name: this.TOOL_NAME,

		description:
			"Show Jira issues and/or Confluence pages to the user as a card under your answer. " +
			"Use this whenever the user asks to see work — a daily plan, a shortlist, a single issue, " +
			"or search results — instead of only describing it in prose. Resolve the content by issue " +
			"keys or URLs, by page ids or URLs, by JQL, or by CQL. Each row carries a link to the " +
			"item, its status, assignee, priority, type and estimate, plus one sentence summarizing " +
			"its description, so the user can act without opening the issue. Call it once per card, " +
			"then write your answer; do not repeat the card's contents as a list in the text. " +
			"One card reads at most 25 items; for a larger set pass a JQL or CQL query rather than a " +
			"long list of keys. The sentence per item is written by one extra model call before the " +
			"card is recorded (up to 25 calls' worth of text, up to about 20 seconds), so a card costs " +
			"a little time and tokens and is worth waiting for. The plugin shows the selected " +
			"Atlassian site; pass cloudId to target another site the account can reach.",

		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				title: {
					type: "string",
					description:
						'Optional heading for the card, such as "План на день". Omit for an untitled card.',
				},
				layout: {
					type: "string",
					enum: ["auto", "single", "compact", "list"],
					description:
						"auto (default) picks by item count: one item as a full card, two to four as " +
						"compact rows, more as a dense list. A card longer than four rows scrolls and " +
						"shows how many items matched. Force one when the content calls for it.",
				},
				issues: {
					type: "array",
					items: { type: "string" },
					maxItems: this.MAX_ITEMS,
					description:
						'Jira issue keys or issue URLs to show, for example ["DEV-6477", "DQ-66"]. ' +
						"At most 25; use jql for a larger set.",
				},
				pages: {
					type: "array",
					items: { type: "string" },
					maxItems: this.MAX_ITEMS,
					description:
						"Confluence page ids or page URLs to show. At most 25; use cql for a larger set.",
				},
				jql: {
					type: "string",
					description:
						"A JQL query whose results become the card, for example " +
						'"assignee = currentUser() AND status != Done ORDER BY priority DESC".',
				},
				cql: {
					type: "string",
					description: "A CQL query whose Confluence results become the card.",
				},
				cloudId: {
					type: "string",
					description:
						"Atlassian cloud id of the site to read. Omit to use the site selected in Settings.",
				},
			},
		},

		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					shown: { type: "integer" },
					summary: { type: "string" },
					failed: { type: "array", items: { type: "string" } },
					// The card payload, carried to the browser as `result.meta`.
					// Left open on purpose: it is presentation data, and the browser
					// half validates it before rendering.
					presentation: { type: "object", additionalProperties: true },
				},
				required: ["shown", "summary", "failed", "presentation"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
			// The browser half reads this back as `result.meta` and renders the
			// card. It never reaches the model: the text above is what the model
			// reads, and this is presentation only.
			presentationMeta: (_args, value) =>
				(value as { presentation: JsonValue }).presentation,
		},

		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const outcome = await this.resolve(deps, args, exec);

			const viewed = this.describe(outcome, args);
			const summary =
				outcome.failed.length === 0
					? viewed
					: `${viewed}\nCould not resolve: ${outcome.failed.join(", ")}`;

			const presentation: AtlassianPresentation = {
				callId: String(exec.callId),
				...(outcome.title === undefined ? {} : { title: outcome.title }),
				layout: outcome.layout,
				...(outcome.cloudId === undefined ? {} : { cloudId: outcome.cloudId }),
				...(outcome.siteUrl === undefined ? {} : { siteUrl: outcome.siteUrl }),
				...(outcome.total === undefined ? {} : { total: outcome.total }),
				...(outcome.truncated ? { truncated: true } : {}),
				items: outcome.items,
			};

			return {
				shown: outcome.items.length,
				summary,
				failed: [...outcome.failed],
				presentation,
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs = (rawArgs: unknown): PresentArgs => {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		const layout = nonEmptyString(args.layout);
		const issues = stringList(args.issues).map((value) => issueKeyOf(value));
		const pages = stringList(args.pages).map((value) => pageIdOf(value));
		const dropped =
			Math.max(0, issues.length - this.MAX_ITEMS) +
			Math.max(0, pages.length - this.MAX_ITEMS);

		return {
			title: nonEmptyString(args.title),
			layout:
				layout === "auto" ||
				layout === "single" ||
				layout === "compact" ||
				layout === "list"
					? layout
					: undefined,
			cloudId: nonEmptyString(args.cloudId),
			issues: issues.slice(0, this.MAX_ITEMS),
			pages: pages.slice(0, this.MAX_ITEMS),
			jql: nonEmptyString(args.jql),
			cql: nonEmptyString(args.cql),
			dropped,
		};
	};

	/** Resolve every requested source into card items. */
	private resolve = async (
		deps: PresentDeps,
		args: PresentArgs,
		exec: ToolExecution,
	): Promise<PresentOutcome> => {
		const cloudId = args.cloudId ?? deps.state.facts?.cloudId;

		if (cloudId === undefined)
			throw new Error(
				"no Atlassian site known yet; run /atlassian sync (or Re-check in Settings), then try again",
			);

		const requested =
			args.issues.length > 0 ||
			args.pages.length > 0 ||
			args.jql !== undefined ||
			args.cql !== undefined;

		if (!requested)
			throw new Error("nothing to show: pass issues, pages, jql, or cql");

		const items: PresentationItem[] = [];
		const failed: string[] = [];
		let matched = 0;
		let truncated = false;

		const push = (candidate: readonly PresentationItem[]): void => {
			for (const item of candidate) {
				if (items.length >= this.MAX_ITEMS) return;
				items.push(item);
			}
		};

		for (const key of args.issues) {
			try {
				const value = await deps.bridge.callTool("getJiraIssue", {
					cloudId,
					issueIdOrKey: key,
					fields: this.ISSUE_FIELDS,
				});

				const found = this.issuesOf(
					value,
					deps.state.facts?.urlOf(cloudId),
					key,
				);
				push(found.items);
				matched += found.total ?? found.items.length;
			} catch (error) {
				failed.push(`${key} — ${messageOf(error)}`);
			}
		}

		if (args.jql !== undefined) {
			const value = await deps.bridge.callTool("searchJiraIssuesUsingJql", {
				cloudId,
				jql: args.jql,
				fields: this.ISSUE_FIELDS,
				maxResults: this.MAX_ITEMS,
			});

			const found = this.issuesOf(value, deps.state.facts?.urlOf(cloudId));
			push(found.items);
			matched += found.total ?? found.items.length;
			if (hasMore(value)) truncated = true;
		}

		for (const id of args.pages) {
			try {
				const value = await deps.bridge.callTool("getConfluencePage", {
					cloudId,
					pageId: id,
				});

				const found = this.pagesOf(value, deps.state.facts?.urlOf(cloudId), id);
				push(found.items);
				matched += found.total ?? found.items.length;
			} catch (error) {
				failed.push(`${id} — ${messageOf(error)}`);
			}
		}

		if (args.cql !== undefined) {
			const value = await deps.bridge.callTool("searchConfluenceUsingCql", {
				cloudId,
				cql: args.cql,
				limit: this.MAX_ITEMS,
			});

			const found = this.pagesOf(value, deps.state.facts?.urlOf(cloudId));
			push(found.items);
			matched += found.total ?? found.items.length;
			if (hasMore(value)) truncated = true;
		}

		// An empty answer is a result, not a bad request: the query ran and matched
		// nothing, which the model must be able to tell from "you sent no query".

		// One sentence per item, written by the conversation's own model. The
		// card is projected again afterwards, so no raw description survives.
		const gists = await this.summarize(deps.ctx, items, exec);
		const projected = items.map((item, index) =>
			item.kind === "issue"
				? {
						kind: "issue" as const,
						issue: this.issueWire(item.issue, gists.get(String(index))),
					}
				: {
						kind: "page" as const,
						page: this.pageWire(item.page, gists.get(String(index))),
					},
		);

		// Keys that were never looked up still belong in the count the card
		// explains: they are part of what the caller asked to see.
		const counted = matched + args.dropped;

		return {
			title: args.title,
			layout: this.resolveLayout(args.layout, projected.length),
			items: projected,
			total: counted > projected.length ? counted : undefined,
			failed,
			truncated,
			dropped: args.dropped,
			cloudId,
			siteUrl: deps.state.facts?.urlOf(cloudId),
		};
	};

	/**
	 * Compress the long text behind each item into one sentence.
	 *
	 * A card is worth waiting a moment for, not a minute: the pass is bounded by
	 * its own timeout and any failure simply leaves the items without summaries.
	 */
	private summarize = async (
		ctx: Context,
		items: readonly PresentationItem[],
		exec: ToolExecution,
	): Promise<ReadonlyMap<string, string>> => {
		const targets = items.flatMap((item, index) => {
			const title =
				item.kind === "issue"
					? (item.issue.summary ?? item.issue.key)
					: item.page.title;
			const body =
				(item.kind === "issue" ? item.issue.rawText : item.page.rawText) ?? "";

			return body === "" ? [] : [{ id: String(index), title, body }];
		});

		if (targets.length === 0) return new Map();

		const gists: readonly Gist[] | undefined = await summarizeGists(
			ctx,
			targets,
			{ route: modelRoute(exec), signal: exec.signal },
		);

		return new Map((gists ?? []).map((gist) => [gist.id, gist.text]));
	};

	/**
	 * The recorded shape of one issue.
	 *
	 * Built field by field rather than spread: `rawText` is the description the
	 * compression pass read, and the card must not carry a word of it.
	 */
	private issueWire = (
		issue: IssueCard,
		gist: string | undefined,
	): IssueCard => ({
		key: issue.key,
		...(issue.summary === undefined ? {} : { summary: issue.summary }),
		...(issue.status === undefined ? {} : { status: issue.status }),
		...(issue.assignee === undefined ? {} : { assignee: issue.assignee }),
		...(issue.priority === undefined ? {} : { priority: issue.priority }),
		...(issue.type === undefined ? {} : { type: issue.type }),
		...(issue.estimate === undefined ? {} : { estimate: issue.estimate }),
		...(gist === undefined ? {} : { description: gist }),
		...(issue.url === undefined ? {} : { url: issue.url }),
	});

	/** The recorded shape of one page; see {@link issueWire}. */
	private pageWire = (page: PageCard, gist: string | undefined): PageCard => ({
		title: page.title,
		...(page.id === undefined ? {} : { id: page.id }),
		...(page.url === undefined ? {} : { url: page.url }),
		...(page.space === undefined ? {} : { space: page.space }),
		...(gist === undefined ? {} : { excerpt: gist }),
	});

	/** Normalize one Jira result; `fallbackKey` keeps a single-issue fetch labelled. */
	private issuesOf(
		value: unknown,
		siteUrl: string | undefined,
		fallbackKey?: string,
	): Found<PresentationItem> {
		const meta: AtlassianMeta = extractor.extract({
			tool: "getJiraIssue",
			args: {},
			value,
			siteUrl,
			// The description is read here and compressed before it is recorded.
			bodies: true,
		});

		const issues = meta.issues as readonly IssueCard[];

		if (issues.length > 0)
			return {
				items: issues.map((issue) => ({ kind: "issue", issue })),
				total: meta.total,
			};

		return {
			items:
				fallbackKey === undefined
					? []
					: [{ kind: "issue", issue: { key: fallbackKey } }],
			total: meta.total,
		};
	}

	/** Normalize one Confluence result; `fallbackId` keeps a single fetch labelled. */
	private pagesOf(
		value: unknown,
		siteUrl: string | undefined,
		fallbackId?: string,
	): Found<PresentationItem> {
		const meta: AtlassianMeta = extractor.extract({
			tool: "getConfluencePage",
			args: {},
			value,
			siteUrl,
			bodies: true,
		});

		const pages = meta.pages as readonly PageCard[];

		if (pages.length > 0)
			return {
				items: pages.map((page) => ({ kind: "page", page })),
				total: meta.total,
			};

		return {
			items:
				fallbackId === undefined
					? []
					: [{ kind: "page", page: { id: fallbackId, title: fallbackId } }],
			total: meta.total,
		};
	}

	/** Pick the layout the caller asked for, or infer one from the item count. */
	private resolveLayout(
		input: PresentationLayoutInput | undefined,
		count: number,
	): PresentationLayout {
		if (input === "single" || input === "compact" || input === "list")
			return input;
		if (count <= 1) return "single";
		if (count <= 4) return "compact";

		return "list";
	}

	/** The text the model reads: what the card shows, in order. */
	private describe(outcome: PresentOutcome, args: PresentArgs): string {
		if (outcome.items.length === 0) {
			const lines = ["No issues or pages matched."];

			if (args.jql !== undefined) lines.push(`JQL: ${args.jql}`);
			if (args.cql !== undefined) lines.push(`CQL: ${args.cql}`);

			return lines.join("\n");
		}

		const issues = outcome.items.filter((item) => item.kind === "issue");
		const pages = outcome.items.filter((item) => item.kind === "page");

		const counts = [
			issues.length > 0
				? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
				: "",
			pages.length > 0
				? `${pages.length} page${pages.length === 1 ? "" : "s"}`
				: "",
		].filter(Boolean);

		const heading =
			outcome.title === undefined
				? "Shown as a card"
				: `Shown as a card titled "${outcome.title}"`;

		const lines = [`${heading}: ${counts.join(" and ")}.`];

		for (const item of outcome.items) {
			if (item.kind === "issue") {
				const parts = [
					item.issue.key,
					item.issue.summary,
					item.issue.status,
					item.issue.assignee,
					item.issue.estimate === undefined
						? undefined
						: `estimate ${item.issue.estimate}`,
					item.issue.url,
				].filter(
					(part): part is string => typeof part === "string" && part !== "",
				);

				lines.push(`- ${parts.join(" · ")}`);
			} else {
				const parts = [item.page.title, item.page.space, item.page.url].filter(
					(part): part is string => typeof part === "string" && part !== "",
				);

				lines.push(`- ${parts.join(" · ")}`);
			}
		}

		if (args.jql !== undefined) lines.push(`JQL: ${args.jql}`);
		if (args.cql !== undefined) lines.push(`CQL: ${args.cql}`);

		if (outcome.total !== undefined && outcome.total > outcome.items.length) {
			lines.push(
				`The server matched ${outcome.total}; this card shows ${outcome.items.length}.`,
			);
		}

		if (outcome.truncated)
			lines.push(
				"The search had more results than this card read; narrow it or ask for another page.",
			);

		if (outcome.dropped > 0) {
			lines.push(
				`${outcome.dropped} more requested item${outcome.dropped === 1 ? "" : "s"} ` +
					`were not looked up: one card reads at most ${this.MAX_ITEMS}. Use JQL or CQL for a larger set.`,
			);
		}

		return lines.join("\n");
	}
}

export const presentTool = new PresentTool();

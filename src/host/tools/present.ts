/**
 * `atlassian_present` — the tool behind a card in the conversation.
 *
 * It resolves what to show (by key, by JQL, by page id, or by CQL), records one
 * durable presentation for the turn, and answers the model with a text summary.
 * The card is presentation only: the model reads the text result, and the record
 * is what the browser half renders under the closing prose.
 *
 * The tool resolves the cloud id itself when the plugin has learned it, so the
 * model does not have to thread that identifier through every call.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { IssueCard, PageCard } from "../../shared/meta";
import type {
	AtlassianPresentation,
	PresentationItem,
	PresentationLayout,
	PresentationLayoutInput,
} from "../../shared/presentation";
import type { JsonValue } from "../json";
import { mcpBridge } from "../mcp/bridge";
import { extractor } from "../presentation/extract";
import type { RuntimeState } from "../state";

/** One tool call's text answer, before it becomes blocks. */
interface PresentOutcome {
	readonly title: string | undefined;
	readonly layout: PresentationLayout;
	readonly items: readonly PresentationItem[];
	/** Requests that could not be resolved, by key or id. */
	readonly failed: readonly string[];
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
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string => typeof item === "string" && item !== "",
	);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

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
	];

	/**
	 * Build the tool definition for one plugin instance.
	 * @param state - runtime state holding the MCP connection and cloud id.
	 */
	create = (state: RuntimeState): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Show Jira issues and/or Confluence pages to the user as a card under your answer. " +
			"Use this whenever the user asks to see work — a daily plan, a shortlist, a single issue, " +
			"or search results — instead of only describing it in prose. Resolve the content by issue " +
			"keys, by page ids, by JQL, or by CQL; the card carries status, assignee, priority and links. " +
			"Call it once per card, then write your answer.",
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
						"compact rows, more as a dense list. Force one when the content calls for it.",
				},
				issues: {
					type: "array",
					items: { type: "string" },
					description: 'Issue keys to show, for example ["DEV-6477", "DQ-66"].',
				},
				pages: {
					type: "array",
					items: { type: "string" },
					description: "Confluence page ids to show.",
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
						"Atlassian cloud id. Omit unless the user has several sites: the plugin remembers it.",
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
			const outcome = await this.resolve(state, args);

			const viewed = this.describe(outcome, args);
			const summary =
				outcome.failed.length === 0
					? viewed
					: `${viewed}\nCould not resolve: ${outcome.failed.join(", ")}`;

			const presentation: AtlassianPresentation = {
				callId: String(exec.callId),
				...(outcome.title === undefined ? {} : { title: outcome.title }),
				layout: outcome.layout,
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
	private parseArgs(rawArgs: unknown): PresentArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		const layout = optionalString(args.layout);

		return {
			title: optionalString(args.title),
			layout:
				layout === "auto" ||
				layout === "single" ||
				layout === "compact" ||
				layout === "list"
					? layout
					: undefined,
			cloudId: optionalString(args.cloudId),
			issues: stringList(args.issues),
			pages: stringList(args.pages),
			jql: optionalString(args.jql),
			cql: optionalString(args.cql),
		};
	}

	/** Resolve every requested source into card items. */
	private resolve = async (
		state: RuntimeState,
		args: PresentArgs,
	): Promise<PresentOutcome> => {
		const cloudId = args.cloudId ?? state.cloudId;

		if (cloudId === undefined)
			throw new Error(
				"no Atlassian site known yet; run a Jira or Confluence search first, or sign in again",
			);

		const items: PresentationItem[] = [];
		const failed: string[] = [];

		const push = (candidate: readonly PresentationItem[]): void => {
			for (const item of candidate) {
				if (items.length >= this.MAX_ITEMS) return;
				items.push(item);
			}
		};

		for (const key of args.issues) {
			try {
				const value = await mcpBridge.callTool(state, "getJiraIssue", {
					cloudId,
					issueIdOrKey: key,
					fields: this.ISSUE_FIELDS,
				});

				push(this.issuesOf(value, key));
			} catch {
				failed.push(key);
			}
		}

		if (args.jql !== undefined) {
			const value = await mcpBridge.callTool(
				state,
				"searchJiraIssuesUsingJql",
				{
					cloudId,
					jql: args.jql,
					fields: this.ISSUE_FIELDS,
					maxResults: this.MAX_ITEMS,
				},
			);

			push(this.issuesOf(value));
		}

		for (const id of args.pages) {
			try {
				const value = await mcpBridge.callTool(state, "getConfluencePage", {
					cloudId,
					pageId: id,
				});

				push(this.pagesOf(value, id));
			} catch {
				failed.push(id);
			}
		}

		if (args.cql !== undefined) {
			const value = await mcpBridge.callTool(
				state,
				"searchConfluenceUsingCql",
				{
					cloudId,
					cql: args.cql,
					limit: this.MAX_ITEMS,
				},
			);

			push(this.pagesOf(value));
		}

		if (items.length === 0 && failed.length === 0)
			throw new Error("nothing to show: pass issues, pages, jql, or cql");

		return {
			title: args.title,
			layout: this.resolveLayout(args.layout, items.length),
			items,
			failed,
		};
	};

	/** Normalize one Jira result; `fallbackKey` keeps a single-issue fetch labelled. */
	private issuesOf(value: unknown, fallbackKey?: string): PresentationItem[] {
		const meta = extractor.extract({
			tool: "getJiraIssue",
			args: {},
			value,
			siteUrl: undefined,
		});

		const issues = meta.issues as readonly IssueCard[];
		if (issues.length > 0)
			return issues.map((issue) => ({ kind: "issue", issue }));

		return fallbackKey === undefined
			? []
			: [{ kind: "issue", issue: { key: fallbackKey } }];
	}

	/** Normalize one Confluence result; `fallbackId` keeps a single fetch labelled. */
	private pagesOf(value: unknown, fallbackId?: string): PresentationItem[] {
		const meta = extractor.extract({
			tool: "getConfluencePage",
			args: {},
			value,
			siteUrl: undefined,
		});

		const pages = meta.pages as readonly PageCard[];
		if (pages.length > 0) return pages.map((page) => ({ kind: "page", page }));

		return fallbackId === undefined
			? []
			: [{ kind: "page", page: { id: fallbackId, title: fallbackId } }];
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

		return lines.join("\n");
	}
}

export const presentTool = new PresentTool();

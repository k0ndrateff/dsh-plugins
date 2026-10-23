/**
 * `sentry_present` — the tool behind a card in the conversation.
 *
 * It resolves what to show — a search, or a list of issue ids — records one
 * durable presentation for the turn, and answers the model with a text summary.
 * The card is presentation only: the model reads the text result, and the
 * record is what the browser half renders under the closing prose.
 *
 * The search tool takes a query in natural language: Sentry's own agent
 * translates it, so the caller may pass the user's question almost verbatim.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { RuntimeState } from "dsh-integration-host";
import { nonEmptyString } from "dsh-integration-host/shape";
import { type JsonValue, type McpBridge, mcpText } from "dsh-mcp-oauth";
import type {
	IssueCard,
	PresentationLayout,
	PresentationLayoutInput,
	SentryPresentation,
	SuspectCommit,
} from "../../shared/meta";
import { parseIssueDetail, parseIssueSearch } from "../presentation/parse";
import type { OrganizationFacts } from "../store/organization";

/** The tool that lists grouped issues. */
const SEARCH_TOOL = "search_issues";

/** The tool that reads one issue. */
const RESOURCE_TOOL = "get_sentry_resource";

/** Never put more than this many issues on one card. */
const MAX_ISSUES = 25;

/** What the tool needs from the plugin. */
export interface PresentDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<OrganizationFacts>;
}

/** The arguments the model may send, after validation. */
interface PresentArgs {
	readonly title: string | undefined;
	readonly layout: PresentationLayoutInput | undefined;
	readonly query: string | undefined;
	readonly issues: readonly string[];
	readonly organization: string | undefined;
	readonly project: string | undefined;
	readonly period: string | undefined;
	readonly sort: string | undefined;
	readonly limit: number | undefined;
}

/** What one resolution pass found. */
interface Found {
	readonly issues: readonly IssueCard[];
	readonly total: number | undefined;
	readonly query: string | undefined;
	readonly dashboardUrl: string | undefined;
	readonly suspect: SuspectCommit | undefined;
	readonly failed: readonly string[];
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return value.filter(
		(item): item is string => typeof item === "string" && item !== "",
	);
}

class PresentTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = "sentry_present";

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the MCP bridge and the plugin's runtime state.
	 */
	create = (deps: PresentDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Show Sentry issues to the user as a card under your answer. Use this whenever the user " +
			"asks to see errors — a shortlist, one issue, what broke in a release — instead of only " +
			"describing it in prose. Resolve the content by a search query or by issue ids; each row " +
			"carries its status, assignee, event and user counts, and links to the issue. Call it once " +
			"per card, then write your answer; do not repeat the card's contents as a list in the text.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				title: {
					type: "string",
					description:
						'Optional heading for the card, such as "Ошибки за сутки". Omit for an untitled card.',
				},
				layout: {
					type: "string",
					enum: ["auto", "single", "compact", "list"],
					description:
						"auto (default) picks by issue count: one issue as a full card, two to four as " +
						"compact rows, more as a dense list.",
				},
				query: {
					type: "string",
					description:
						"What to find, in natural language or Sentry search syntax, for example " +
						'"unresolved errors in checkout from the last day" or "is:unresolved level:error".',
				},
				issues: {
					type: "array",
					items: { type: "string" },
					description:
						'Issue ids to show, for example ["CHECKOUT-13P", "CHECKOUT-177"].',
				},
				organization: {
					type: "string",
					description:
						"Sentry organization slug. Omit unless the user has several: the plugin remembers it.",
				},
				project: {
					type: "string",
					description: "Project slug to narrow a search to.",
				},
				period: {
					type: "string",
					enum: ["24h", "7d", "14d", "30d", "90d"],
					description:
						"How far back a search looks. Defaults to Sentry's own 30d.",
				},
				sort: {
					type: "string",
					enum: ["date", "freq", "new", "user", "recommended"],
					description:
						"Search order: last seen, frequency, first seen, user count, or Sentry's ranking.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 25,
					description: "How many issues to show. Defaults to 10.",
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
					presentation: { type: "object", additionalProperties: true },
				},
				required: ["shown", "summary", "failed", "presentation"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
			// The browser half reads this back as `result.meta` and renders the card.
			// It never reaches the model: the text above is what the model reads.
			presentationMeta: (_args, value) =>
				(value as { presentation: JsonValue }).presentation,
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const found = await this.resolve(deps, args);
			const presentation: SentryPresentation = {
				callId: String(exec.callId),
				...(args.title === undefined ? {} : { title: args.title }),
				layout: this.resolveLayout(args.layout, found.issues.length),
				...(found.total === undefined ? {} : { total: found.total }),
				...(found.query === undefined ? {} : { query: found.query }),
				...(found.dashboardUrl === undefined
					? {}
					: { dashboardUrl: found.dashboardUrl }),
				issues: found.issues,
				...(found.suspect === undefined ? {} : { suspect: found.suspect }),
			};

			const viewed = this.describe(presentation);
			const summary =
				found.failed.length === 0
					? viewed
					: `${viewed}\nCould not resolve: ${found.failed.join(", ")}`;

			return {
				shown: found.issues.length,
				summary,
				failed: [...found.failed],
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

		const layout = nonEmptyString(args.layout);
		const limit = Number(args.limit);

		return {
			title: nonEmptyString(args.title),
			layout:
				layout === "auto" ||
				layout === "single" ||
				layout === "compact" ||
				layout === "list"
					? layout
					: undefined,
			query: nonEmptyString(args.query),
			issues: stringList(args.issues),
			organization: nonEmptyString(args.organization),
			project: nonEmptyString(args.project),
			period: nonEmptyString(args.period),
			sort: nonEmptyString(args.sort),
			limit:
				Number.isInteger(limit) && limit > 0
					? Math.min(limit, MAX_ISSUES)
					: undefined,
		};
	}

	/** Resolve every requested source into card rows. */
	private async resolve(deps: PresentDeps, args: PresentArgs): Promise<Found> {
		const organization = args.organization ?? deps.state.facts?.slug;

		if (organization === undefined)
			throw new Error(
				"no Sentry organization known yet; sign in first, or pass one",
			);

		const requested = args.query !== undefined || args.issues.length > 0;

		if (!requested)
			throw new Error("nothing to show: pass a query or issue ids");

		const failed: string[] = [];
		const issues: IssueCard[] = [];
		let suspect: SuspectCommit | undefined;
		let total: number | undefined;
		let query: string | undefined;
		let dashboardUrl: string | undefined;

		if (args.query !== undefined) {
			const value = await deps.bridge.callTool(SEARCH_TOOL, {
				organizationSlug: organization,
				query: args.query,
				limit: args.limit ?? 10,
				...(args.project === undefined
					? {}
					: { projectSlugOrId: args.project }),
				...(args.period === undefined ? {} : { period: args.period }),
				...(args.sort === undefined ? {} : { sort: args.sort }),
			});
			const found = parseIssueSearch(mcpText(value).join("\n"));

			issues.push(...found.issues.slice(0, MAX_ISSUES));
			total = found.total;
			query = found.query ?? args.query;
			dashboardUrl = found.dashboardUrl;
		}

		for (const id of args.issues) {
			try {
				const value = await deps.bridge.callTool(RESOURCE_TOOL, {
					organizationSlug: organization,
					resourceType: "issue",
					resourceId: id,
				});
				const detail = parseIssueDetail(mcpText(value).join("\n"));

				if (detail.id === "") throw new Error("no issue in the answer");

				if (issues.length < MAX_ISSUES) issues.push(this.cardOf(detail));
				suspect = suspect ?? detail.suspect;
			} catch {
				failed.push(id);
			}
		}

		// A suspect commit belongs to one issue. Under a list or a search it would
		// read as the cause of every row.
		if (args.query !== undefined || args.issues.length !== 1)
			suspect = undefined;

		// A search that matched nothing is an answer, not a caller's mistake.

		return {
			issues,
			total,
			query,
			dashboardUrl,
			suspect,
			failed,
		};
	}

	/** One card row out of a whole issue document. */
	private cardOf(detail: {
		id: string;
		description?: string;
		url?: string;
		status?: string;
		assignee?: string;
		occurrences?: number;
		users?: number;
		firstSeen?: string;
		lastSeen?: string;
		culprit?: string;
		project?: string;
	}): IssueCard {
		return {
			id: detail.id,
			title: detail.description ?? detail.id,
			...(detail.url === undefined ? {} : { url: detail.url }),
			...(detail.status === undefined ? {} : { status: detail.status }),
			...(detail.assignee === undefined ? {} : { assignee: detail.assignee }),
			...(detail.occurrences === undefined
				? {}
				: { events: detail.occurrences }),
			...(detail.users === undefined ? {} : { users: detail.users }),
			...(detail.firstSeen === undefined
				? {}
				: { firstSeen: detail.firstSeen }),
			...(detail.lastSeen === undefined ? {} : { lastSeen: detail.lastSeen }),
			...(detail.culprit === undefined ? {} : { culprit: detail.culprit }),
			...(detail.project === undefined ? {} : { project: detail.project }),
		};
	}

	/** Pick the layout the caller asked for, or infer one from the row count. */
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
	private describe(presentation: SentryPresentation): string {
		if (presentation.issues.length === 0) {
			const lines = ["No issues matched."];

			if (presentation.query !== undefined)
				lines.push(`Query: ${presentation.query}`);
			if (presentation.dashboardUrl !== undefined)
				lines.push(`All results: ${presentation.dashboardUrl}`);

			return lines.join("\n");
		}

		const heading =
			presentation.title === undefined
				? "Shown as a card"
				: `Shown as a card titled "${presentation.title}"`;
		const lines = [
			`${heading}: ${presentation.issues.length} issue${presentation.issues.length === 1 ? "" : "s"}.`,
		];

		for (const issue of presentation.issues) {
			const parts = [
				issue.id,
				issue.title,
				issue.status,
				issue.assignee,
				issue.events === undefined ? undefined : `${issue.events} events`,
				issue.users === undefined ? undefined : `${issue.users} users`,
				issue.url,
			].filter(
				(part): part is string => typeof part === "string" && part !== "",
			);

			lines.push(`- ${parts.join(" · ")}`);
		}

		if (presentation.query !== undefined)
			lines.push(`Query: ${presentation.query}`);
		if (presentation.dashboardUrl !== undefined)
			lines.push(`All results: ${presentation.dashboardUrl}`);
		if (presentation.suspect !== undefined) {
			const commit = presentation.suspect;

			lines.push(
				`Suspect commit: ${commit.sha.slice(0, 12)}${commit.message === undefined ? "" : ` — ${commit.message}`}${commit.issueKey === undefined ? "" : ` (${commit.issueKey})`}`,
			);
		}

		return lines.join("\n");
	}
}

export const presentTool = new PresentTool();

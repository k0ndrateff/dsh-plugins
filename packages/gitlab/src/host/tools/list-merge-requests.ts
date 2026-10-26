/**
 * `gitlab_list_merge_requests` — merge requests as rows the model can read.
 *
 * The agent needs the list itself for its own reasoning: what is waiting for a
 * review, what it is assigned, what runs in a project. The card tool of the same
 * plugin shows rows to the user; this one answers the model, and both ask GitLab
 * through the same request builder so the two cannot disagree.
 *
 * A list endpoint answers one page, so the answer always says which page it read,
 * how many rows that page held and whether GitLab named another page. Without
 * that the model takes the first page of 25 for the whole list and reports a
 * truncated set as complete.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { RuntimeState } from "dsh-integration-host";
import { nonEmptyString } from "dsh-integration-host/shape";
import type { MergeRequestCard } from "../../shared/meta";
import { GITLAB_LIST_MERGE_REQUESTS_TOOL } from "../../shared/tools";
import type { GitLabAccount } from "../account";
import type { GitLabApi } from "../api";
import { parseMergeRequestList } from "../presentation/parse";
import {
	listParamsOf,
	listPathOf,
	type MergeRequestListQuery,
	MR_LIST_PAGE_SIZE,
} from "./query";
import { mrLine } from "./text";

/** The merge request scopes GitLab resolves relative to the signed-in user. */
const SCOPES = ["review_requested", "assigned_to_me", "created_by_me"] as const;

/** The states GitLab's list endpoints filter by. */
const STATES = ["opened", "closed", "merged", "locked", "all"] as const;

/** A scope as a person reads it, rather than GitLab's own enum value. */
const SCOPE_LABELS: Readonly<Record<string, string>> = {
	review_requested: "waiting for your review",
	assigned_to_me: "assigned to you",
	created_by_me: "created by you",
};

/** What the tool needs from the plugin. */
export interface ListMergeRequestsDeps {
	readonly api: GitLabApi;
	readonly state: RuntimeState<GitLabAccount>;
}

class ListMergeRequestsTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = GITLAB_LIST_MERGE_REQUESTS_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the channel to GitLab and the plugin's runtime state.
	 */
	create = (deps: ListMergeRequestsDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"List GitLab merge requests — waiting for your review, assigned to you, created by you, " +
			"or a project's or group's — with their state, draft flag, author, reviewers, branches, " +
			"labels and note count. Use this to answer questions about merge requests instead of " +
			"running `glab` or `curl`: the plugin reads GitLab with the personal access token stored " +
			"in the harness, and no shell command can see that token. A list answer carries no " +
			"pipeline status and no unresolved-thread count — GitLab's list endpoints do not send " +
			"them; read one merge request for those. GitLab answers one page at a time: the answer " +
			"names the page it read and the next page when there is one — pass `page` to continue " +
			"rather than reporting the first page as the whole list.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				scope: {
					type: "string",
					enum: [...SCOPES],
					description:
						"Which merge requests to list relative to the signed-in user: review_requested " +
						"(waiting for their review), assigned_to_me, or created_by_me.",
				},
				project: {
					type: "string",
					description:
						"Project path to narrow a list to, such as group/project.",
				},
				group: {
					type: "string",
					description:
						"Group path to list merge requests across, including its subgroups.",
				},
				state: {
					type: "string",
					enum: [...STATES],
					description:
						"Merge request state to list. Omit to include any state: the list then asks " +
						'GitLab for state "all" instead of quietly narrowing it to open requests.',
				},
				search: {
					type: "string",
					description:
						"Text matched against merge request titles and descriptions.",
				},
				labels: {
					type: "string",
					description: "Comma-separated labels every result must carry.",
				},
				author: {
					type: "string",
					description: "GitLab username whose merge requests to list.",
				},
				reviewer: {
					type: "string",
					description: "GitLab username who must be a reviewer.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: MR_LIST_PAGE_SIZE,
					description:
						"How many merge requests one page holds. Defaults to 10; GitLab is never asked " +
						"for more than 25.",
				},
				page: {
					type: "integer",
					minimum: 1,
					description:
						"Which page to read, starting at 1. The previous answer names the next page " +
						"when GitLab has one.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					summary: { type: "string" },
					count: { type: "integer" },
					total: { type: "integer" },
					page: { type: "integer" },
					nextPage: { type: "integer" },
					truncated: { type: "boolean" },
					items: {
						type: "array",
						items: { type: "object", additionalProperties: true },
					},
				},
				required: ["summary", "count", "items"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
		},
		execute: async (rawArgs) => {
			const query = this.parseArgs(rawArgs);
			const answer = await deps.api.getAnswer(
				listPathOf(query),
				listParamsOf(deps.state, query),
			);
			const listed = parseMergeRequestList(answer.value);
			const items = listed.items.slice(0, MR_LIST_PAGE_SIZE);
			const total = answer.total ?? listed.total;
			const page = query.page ?? 1;
			const nextPage = this.nextPageOf(page, items.length, query, total);
			const label = this.labelOf(query);
			const summary = this.textOf(items, {
				total,
				page,
				nextPage,
				label,
			});

			return {
				summary,
				count: items.length,
				...(total === undefined ? {} : { total }),
				page,
				...(nextPage === undefined ? {} : { nextPage }),
				...(nextPage === undefined ? {} : { truncated: true }),
				items,
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): MergeRequestListQuery {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		const scope = nonEmptyString(args.scope);
		const state = nonEmptyString(args.state);
		const limit = args.limit === undefined ? undefined : Number(args.limit);
		const page = args.page === undefined ? undefined : Number(args.page);

		if (scope !== undefined && !(SCOPES as readonly string[]).includes(scope))
			throw new Error(
				`"${scope}" is not a merge request scope; use ${SCOPES.join(", ")}`,
			);

		if (state !== undefined && !(STATES as readonly string[]).includes(state))
			throw new Error(
				`"${state}" is not a merge request state; use ${STATES.join(", ")}`,
			);

		if (
			limit !== undefined &&
			(!Number.isInteger(limit) || limit < 1 || limit > MR_LIST_PAGE_SIZE)
		)
			throw new Error(
				`"${String(args.limit)}" is not a page size; pass a whole number from 1 to ${MR_LIST_PAGE_SIZE}, or omit it for 10`,
			);

		if (page !== undefined && (!Number.isInteger(page) || page < 1))
			throw new Error(
				`"${String(args.page)}" is not a page number; pass a whole number starting at 1, or omit it for the first page`,
			);

		return {
			scope,
			project: nonEmptyString(args.project),
			group: nonEmptyString(args.group),
			state,
			search: nonEmptyString(args.search),
			labels: nonEmptyString(args.labels),
			author: nonEmptyString(args.author),
			reviewer: nonEmptyString(args.reviewer),
			limit,
			page,
		};
	}

	/**
	 * The next page's number when this page cannot be the whole list.
	 *
	 * `x-total` answers the question outright; without it, a full page is the
	 * only sign that more may exist, and the model is told to ask rather than
	 * assume the answer ended there.
	 */
	private nextPageOf(
		page: number,
		shown: number,
		query: MergeRequestListQuery,
		total: number | undefined,
	): number | undefined {
		if (total !== undefined)
			return page * (query.limit ?? 10) < total ? page + 1 : undefined;

		return shown >= (query.limit ?? 10) ? page + 1 : undefined;
	}

	/** The one filter the heading names, so the rows are known to be a subset. */
	private labelOf(query: MergeRequestListQuery): string | undefined {
		if (query.scope !== undefined)
			return SCOPE_LABELS[query.scope] ?? query.scope;
		if (query.search !== undefined) return `search "${query.search}"`;

		return query.project ?? query.group;
	}

	/** The model's text: the count, the page, the query, then one row each. */
	private textOf(
		items: readonly MergeRequestCard[],
		context: {
			readonly total: number | undefined;
			readonly page: number;
			readonly nextPage: number | undefined;
			readonly label: string | undefined;
		},
	): string {
		const label = context.label;

		if (items.length === 0)
			return label === undefined
				? "No merge requests matched."
				: `No merge requests matched.\nQuery: ${label}`;

		const shown = items.length;
		const counted =
			context.total !== undefined && context.total > shown
				? ` of ${context.total}`
				: "";
		const heading = `Merge requests: ${shown} shown on page ${context.page}${counted}${label === undefined ? "" : ` · ${label}`}`;
		const lines = [heading, ...items.map((item) => `- ${mrLine(item)}`)];

		if (context.nextPage !== undefined)
			lines.push(
				`…more may exist: call ${GITLAB_LIST_MERGE_REQUESTS_TOOL} again with page: ${context.nextPage} (limit: ${MR_LIST_PAGE_SIZE} widens each page).`,
			);

		return lines.join("\n");
	}
}

export const listMergeRequestsTool = new ListMergeRequestsTool();

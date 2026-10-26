/**
 * `gitlab_list_merge_requests` — merge requests as rows the model can read.
 *
 * The agent needs the list itself for its own reasoning: what is waiting for a
 * review, what it is assigned, what runs in a project. The card tool of the same
 * plugin shows rows to the user; this one answers the model, and both ask GitLab
 * through the same request builder so the two cannot disagree.
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
			"them; read one merge request for those.",
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
						"Merge request state to list. Omit to include any state.",
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
					description: "How many merge requests to list. Defaults to 10.",
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
			const label = this.labelOf(query);
			const summary = this.textOf(items, total, label);

			return {
				summary,
				count: items.length,
				...(total === undefined ? {} : { total }),
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
		const limit = Number(args.limit);

		if (scope !== undefined && !(SCOPES as readonly string[]).includes(scope))
			throw new Error(
				`"${scope}" is not a merge request scope; use ${SCOPES.join(", ")}`,
			);

		if (state !== undefined && !(STATES as readonly string[]).includes(state))
			throw new Error(
				`"${state}" is not a merge request state; use ${STATES.join(", ")}`,
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
			limit:
				Number.isInteger(limit) && limit > 0
					? Math.min(limit, MR_LIST_PAGE_SIZE)
					: undefined,
		};
	}

	/** The one filter the heading names, so the rows are known to be a subset. */
	private labelOf(query: MergeRequestListQuery): string | undefined {
		if (query.scope !== undefined) return query.scope;
		if (query.search !== undefined) return `search "${query.search}"`;

		return query.project ?? query.group;
	}

	/** The model's text: the count, the query, then one row per merge request. */
	private textOf(
		items: readonly MergeRequestCard[],
		total: number | undefined,
		label: string | undefined,
	): string {
		if (items.length === 0)
			return label === undefined
				? "No merge requests matched."
				: `No merge requests matched.\nQuery: ${label}`;

		const shown = items.length;
		const counted = total !== undefined && total > shown ? ` of ${total}` : "";
		const heading = `Merge requests: ${shown} shown${counted}${label === undefined ? "" : ` · ${label}`}`;

		return [heading, ...items.map((item) => `- ${mrLine(item)}`)].join("\n");
	}
}

export const listMergeRequestsTool = new ListMergeRequestsTool();

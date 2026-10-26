/**
 * `gitlab_present` — the tool behind a card in the conversation.
 *
 * It resolves what to show — merge requests by reference, by scope, by search,
 * a merge request's review findings, or its failed jobs — records one durable
 * presentation for the turn, and answers the model with a text summary. The card
 * is presentation only: the model reads the text result, and the record is what
 * the browser half renders under the closing prose.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { RuntimeState } from "dsh-integration-host";
import { nonEmptyString } from "dsh-integration-host/shape";
import type { JsonValue } from "dsh-mcp-oauth";
import type {
	GitLabPresentation,
	JobCard,
	PresentationItem,
	PresentationLayout,
	PresentationLayoutInput,
} from "../../shared/meta";
import { type Discussion, isFinding } from "../../shared/panel";
import { GITLAB_PRESENT_TOOL } from "../../shared/tools";
import type { GitLabAccount } from "../account";
import type { GitLabApi } from "../api";
import {
	findingOf,
	parseDiscussions,
	parseJobs,
	parseMergeRequestCard,
	parseMergeRequestList,
	parsePipeline,
	parseReference,
} from "../presentation/parse";
import { listParamsOf, listPathOf } from "./query";
import { findingLine, mrLine } from "./text";

/** Never put more than this many rows on one card. */
const MAX_ITEMS = 25;

/** The merge request scopes GitLab resolves relative to the signed-in user. */
const SCOPES = ["review_requested", "assigned_to_me", "created_by_me"] as const;

/** What the tool needs from the plugin. */
export interface PresentDeps {
	readonly api: GitLabApi;
	readonly state: RuntimeState<GitLabAccount>;
}

/** The arguments the model may send, after validation. */
interface PresentArgs {
	readonly title: string | undefined;
	readonly layout: PresentationLayoutInput | undefined;
	readonly mergeRequests: readonly string[];
	readonly findings: readonly string[];
	readonly jobs: readonly string[];
	readonly scope: string | undefined;
	readonly project: string | undefined;
	readonly group: string | undefined;
	readonly state: string | undefined;
	readonly search: string | undefined;
	readonly limit: number | undefined;
}

/** What one resolution pass found. */
interface Found {
	readonly items: readonly PresentationItem[];
	readonly total: number | undefined;
	readonly query: string | undefined;
	readonly subject: string | undefined;
	readonly truncated: boolean;
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
	readonly TOOL_NAME = GITLAB_PRESENT_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the channel to GitLab and the plugin's runtime state.
	 */
	create = (deps: PresentDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Show GitLab merge requests, review findings, or failed CI jobs to the user as a card " +
			"under your answer. Use this whenever the user asks to see work — merge requests waiting " +
			"for their review, their own merge requests, what a reviewer asked for, why a pipeline " +
			"failed — instead of only describing it in prose. Resolve the content by merge request " +
			"references, by scope, by search, or by naming a merge request's findings or failed jobs. " +
			"Each row links to the item and carries its state, author, reviewers and pipeline. Call it " +
			"once per card, then write your answer; do not repeat the card's contents as a list in the text. " +
			"Reading merge request data for your own reasoning is gitlab_list_merge_requests or " +
			"gitlab_get_merge_request; gitlab_present is for showing a card.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				title: {
					type: "string",
					description:
						'Optional heading for the card, such as "Ждут моего ревью". Omit for an untitled card.',
				},
				layout: {
					type: "string",
					enum: ["auto", "single", "compact", "list"],
					description:
						"auto (default) picks by row count: one row as a full card, two to four as " +
						"compact rows, more as a dense list.",
				},
				mergeRequests: {
					type: "array",
					items: { type: "string" },
					description:
						'Merge requests to show, as references, for example ["group/project!12"] or their URLs.',
				},
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
					enum: ["opened", "closed", "merged", "locked", "all"],
					description:
						"Merge request state to list. Omit to include any state.",
				},
				search: {
					type: "string",
					description:
						"Text matched against merge request titles and descriptions.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 25,
					description: "How many merge requests to show. Defaults to 10.",
				},
				findings: {
					type: "array",
					items: { type: "string" },
					description:
						"Merge requests whose review threads to show as a task list, for example " +
						'["group/project!12"]. Each row names the file, the note, and whether the thread is resolved.',
				},
				jobs: {
					type: "array",
					items: { type: "string" },
					description:
						'Merge requests whose failed CI jobs to show, for example ["group/project!12"].',
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
			const presentation: GitLabPresentation = {
				callId: String(exec.callId),
				...(args.title === undefined ? {} : { title: args.title }),
				layout: this.resolveLayout(args.layout, found.items.length),
				...(found.total === undefined ? {} : { total: found.total }),
				...(found.query === undefined ? {} : { query: found.query }),
				...(found.subject === undefined ? {} : { subject: found.subject }),
				...(found.truncated ? { truncated: true } : {}),
				items: found.items,
			};

			const viewed = this.describe(presentation);
			const summary =
				found.failed.length === 0
					? viewed
					: `${viewed}\nCould not resolve: ${found.failed.join(", ")}`;

			return {
				shown: found.items.length,
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
			mergeRequests: stringList(args.mergeRequests),
			findings: stringList(args.findings),
			jobs: stringList(args.jobs),
			scope: nonEmptyString(args.scope),
			project: nonEmptyString(args.project),
			group: nonEmptyString(args.group),
			state: nonEmptyString(args.state),
			search: nonEmptyString(args.search),
			limit:
				Number.isInteger(limit) && limit > 0
					? Math.min(limit, MAX_ITEMS)
					: undefined,
		};
	}

	/** Resolve every requested source into card rows. */
	private async resolve(deps: PresentDeps, args: PresentArgs): Promise<Found> {
		const requested =
			args.mergeRequests.length > 0 ||
			args.findings.length > 0 ||
			args.jobs.length > 0 ||
			args.scope !== undefined ||
			args.project !== undefined ||
			args.group !== undefined ||
			args.search !== undefined;

		if (!requested)
			throw new Error(
				"nothing to show: pass merge request references, a scope, a search, findings, or jobs",
			);

		const failed: string[] = [];
		const items: PresentationItem[] = [];
		let total: number | undefined;
		let query: string | undefined;
		let subject: string | undefined;
		let truncated = false;

		if (args.mergeRequests.length > 0) {
			for (const reference of args.mergeRequests) {
				const ref = parseReference(reference);

				if (ref === undefined) {
					failed.push(reference);

					continue;
				}

				try {
					const card = parseMergeRequestCard(
						await deps.api.get(this.mrPath(ref.project, ref.iid)),
					);

					if (card === undefined) throw new Error("no merge request");

					if (items.length < MAX_ITEMS)
						items.push({ kind: "merge_request", mergeRequest: card });
				} catch {
					failed.push(reference);
				}
			}
		} else if (
			args.scope !== undefined ||
			args.project !== undefined ||
			args.group !== undefined ||
			args.search !== undefined
		) {
			const answer = await deps.api.getAnswer(
				listPathOf(args),
				listParamsOf(deps.state, args),
			);
			const listed = parseMergeRequestList(answer.value);

			for (const card of listed.items.slice(0, MAX_ITEMS))
				items.push({ kind: "merge_request", mergeRequest: card });

			total = answer.total ?? listed.total;
			query = this.queryOf(args);
		}

		for (const reference of args.findings) {
			const ref = parseReference(reference);

			if (ref === undefined) {
				failed.push(reference);

				continue;
			}

			try {
				const discussionsPage = await deps.api.getAll(
					`${this.mrPath(ref.project, ref.iid)}/discussions`,
				);
				const discussions = parseDiscussions(discussionsPage.items);

				if (discussionsPage.truncated) truncated = true;

				subject = `${ref.project}!${ref.iid}`;
				items.push(
					...this.findingsOf(discussions, ref).slice(
						0,
						Math.max(0, MAX_ITEMS - items.length),
					),
				);
			} catch {
				failed.push(reference);
			}
		}

		for (const reference of args.jobs) {
			const ref = parseReference(reference);

			if (ref === undefined) {
				failed.push(reference);

				continue;
			}

			try {
				const jobs = await this.failedJobs(deps, ref);

				subject = `${ref.project}!${ref.iid}`;
				items.push(
					...jobs
						.slice(0, Math.max(0, MAX_ITEMS - items.length))
						.map((job): PresentationItem => ({ kind: "job", job })),
				);
			} catch {
				failed.push(reference);
			}
		}

		// An empty list is an answer: nothing is waiting, or the search matched
		// nothing. The caller already knows it sent a query.

		return { items, total, query, subject, truncated, failed };
	}

	/** The API path of one merge request. */
	private mrPath(project: string, iid: number): string {
		return `/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
	}

	/** The review threads of one merge request, unresolved ones first. */
	private findingsOf(
		discussions: readonly Discussion[],
		ref: { project: string; iid: number },
	): PresentationItem[] {
		const findings = discussions
			.filter((discussion) => isFinding(discussion))
			.sort((left, right) => Number(left.resolved) - Number(right.resolved));

		const items: PresentationItem[] = [];
		for (const discussion of findings) {
			const item = findingOf(discussion, ref);
			if (item !== undefined) items.push(item);
		}

		return items;
	}

	/** The failed jobs of one merge request's newest pipeline. */
	private async failedJobs(
		deps: PresentDeps,
		ref: { project: string; iid: number },
	): Promise<JobCard[]> {
		const listed = parsePipeline(
			await deps.api.get(`${this.mrPath(ref.project, ref.iid)}/pipelines`, {
				per_page: 20,
			}),
		);

		if (listed === null) return [];

		const jobs = parseJobs(
			await deps.api.getAll(
				`/projects/${encodeURIComponent(ref.project)}/pipelines/${listed.id}/jobs`,
				{ scope: "failed" },
			),
		);

		return jobs
			.filter((job) => job.status === "failed")
			.map((job) => ({
				project: ref.project,
				iid: ref.iid,
				id: job.id,
				name: job.name,
				status: job.status,
				...(job.stage === undefined ? {} : { stage: job.stage }),
				...(job.failureReason === undefined
					? {}
					: { failureReason: job.failureReason }),
				...(job.url === undefined ? {} : { url: job.url }),
			}));
	}

	/** The scope or search one list ran, for the card's own meta line. */
	private queryOf(args: PresentArgs): string | undefined {
		if (args.search !== undefined) return args.search;
		if (args.scope !== undefined) return args.scope;

		return args.project ?? args.group;
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
	private describe(presentation: GitLabPresentation): string {
		if (presentation.items.length === 0) {
			const lines = ["No merge requests, findings or jobs matched."];

			if (presentation.query !== undefined)
				lines.push(`Query: ${presentation.query}`);
			if (presentation.subject !== undefined)
				lines.push(`Merge request: ${presentation.subject}`);
			if (presentation.truncated === true)
				lines.push("GitLab had more rows than this answer read.");

			return lines.join("\n");
		}

		const heading =
			presentation.title === undefined
				? "Shown as a card"
				: `Shown as a card titled "${presentation.title}"`;
		const count = presentation.items.length;
		const total =
			presentation.total !== undefined && presentation.total > count
				? presentation.total
				: undefined;
		const lines = [
			`${heading}: ${total === undefined ? count : `${count} of ${total}`} item${(total ?? count) === 1 ? "" : "s"}.`,
		];

		for (const item of presentation.items) {
			if (item.kind === "merge_request") {
				lines.push(`- ${mrLine(item.mergeRequest)}`);
			} else if (item.kind === "finding") {
				lines.push(`- ${findingLine(item.finding)}`);
			} else {
				const job = item.job;

				lines.push(
					`- job ${job.name}${job.stage === undefined ? "" : ` (${job.stage})`} · ${job.status}${job.failureReason === undefined ? "" : ` · ${job.failureReason}`}${job.url === undefined ? "" : ` · ${job.url}`}`,
				);
			}
		}

		if (presentation.query !== undefined)
			lines.push(`Query: ${presentation.query}`);
		if (presentation.subject !== undefined)
			lines.push(`Merge request: ${presentation.subject}`);

		return lines.join("\n");
	}
}

export const presentTool = new PresentTool();

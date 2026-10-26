/**
 * `gitlab_get_merge_request` — one merge request, read for the model itself.
 *
 * A merge request is its own document, and the interesting parts are separate
 * endpoints: the diff, the review threads and the head pipeline with its jobs.
 * Each facet is read only when the caller asks for it, because a merge request
 * with a long diff and a long discussion history costs several calls and the
 * model usually needs one of them.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { nonEmptyString } from "dsh-integration-host/shape";
import type {
	DiffFile,
	Discussion,
	DiscussionNote,
	MergeRequestDetail,
	NotePosition,
	PipelineJob,
	PipelineSummary,
} from "../../shared/panel";
import { GITLAB_GET_MERGE_REQUEST_TOOL } from "../../shared/tools";
import type { GitLabApi } from "../api";
import {
	parseDiffFiles,
	parseDiscussions,
	parseJobs,
	parseMergeRequestDetail,
	parsePipeline,
	parseReference,
} from "../presentation/parse";
import { bounded } from "./text";

/** How much of the description the model reads. */
const MAX_DESCRIPTION_CHARS = 4_000;

/** How much patch text the diff facet prints before it stops. */
const MAX_DIFF_PATCH_CHARS = 48_000;

/** The most threads one answer lists. */
const MAX_THREADS = 50;

/** The most notes one answer lists from a thread. */
const MAX_NOTES_PER_THREAD = 20;

/** How much of one note the model reads. */
const MAX_NOTE_CHARS = 1_000;

/** What the tool needs from the plugin. */
export interface GetMergeRequestDeps {
	readonly api: GitLabApi;
}

/** The arguments the model may send, after validation. */
interface GetMergeRequestArgs {
	readonly mergeRequest: string;
	readonly diff: boolean;
	readonly discussions: boolean;
	readonly pipeline: boolean;
	readonly unresolvedOnly: boolean;
}

/** The facets that were requested; absent means "do not read it". */
interface MergeRequestFacets {
	readonly diffs?: readonly DiffFile[];
	readonly discussions?: readonly Discussion[];
	/** Null when the facet was requested and the merge request has no pipeline. */
	readonly pipeline?: PipelineSummary | null;
	/** The threads still open, when the discussion facet counted them. */
	readonly unresolved?: number;
}

class GetMergeRequestTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = GITLAB_GET_MERGE_REQUEST_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the channel to GitLab.
	 */
	create = (deps: GetMergeRequestDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Read one GitLab merge request: its description, state, author, reviewers, labels, " +
			"branches, merge status and URL, and on request its diff, its review discussions and its " +
			"newest pipeline with jobs. Name it as `group/project!12` or by its URL. Use this to " +
			"inspect a merge request instead of running `glab` or `curl`; the token stays in the " +
			"harness.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["mergeRequest"],
			properties: {
				mergeRequest: {
					type: "string",
					description:
						'The merge request, as a reference such as "group/project!12" or its URL.',
				},
				diff: {
					type: "boolean",
					description: "Include changed files and their patch text.",
				},
				discussions: {
					type: "boolean",
					description: "Include review threads.",
				},
				pipeline: {
					type: "boolean",
					description: "Include the newest pipeline and its jobs.",
				},
				unresolvedOnly: {
					type: "boolean",
					description: "With discussions, drop resolved threads.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					summary: { type: "string" },
					mr: { type: "object", additionalProperties: true },
					diffs: {
						type: "array",
						items: { type: "object", additionalProperties: true },
					},
					discussions: {
						type: "array",
						items: { type: "object", additionalProperties: true },
					},
					pipeline: { type: "object", additionalProperties: true },
					truncated: { type: "boolean" },
				},
				required: ["summary", "mr"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
		},
		execute: async (rawArgs) => {
			const args = this.parseArgs(rawArgs);
			const reference = parseReference(args.mergeRequest);

			if (reference === undefined)
				throw new Error(
					`"${args.mergeRequest}" is not a merge request reference; use group/project!12`,
				);

			const base = `/projects/${encodeURIComponent(reference.project)}/merge_requests/${reference.iid}`;
			const mr = parseMergeRequestDetail(await deps.api.get(base), reference);

			if (mr === undefined)
				throw new Error(
					`GitLab returned no merge request for ${reference.project}!${reference.iid}`,
				);

			const facets = await this.readFacets(deps, base, reference.project, args);
			const report = this.describe(mr, facets);

			return {
				summary: report.text,
				mr,
				...(facets.diffs === undefined ? {} : { diffs: facets.diffs }),
				...(facets.discussions === undefined
					? {}
					: { discussions: facets.discussions }),
				...(facets.pipeline === undefined || facets.pipeline === null
					? {}
					: { pipeline: facets.pipeline }),
				...(report.truncated ? { truncated: true } : {}),
			};
		},
	});

	/** Read every facet the caller asked for, and nothing else. */
	private async readFacets(
		deps: GetMergeRequestDeps,
		base: string,
		project: string,
		args: GetMergeRequestArgs,
	): Promise<MergeRequestFacets> {
		const facets: {
			diffs?: readonly DiffFile[];
			discussions?: readonly Discussion[];
			pipeline?: PipelineSummary | null;
			unresolved?: number;
		} = {};

		if (args.diff) {
			const page = await deps.api.getAll(`${base}/diffs`);
			facets.diffs = parseDiffFiles({ diffs: page.items });
		}

		if (args.discussions) {
			const page = await deps.api.getAll(`${base}/discussions`);
			const threads = parseDiscussions({ discussions: page.items });

			facets.unresolved = threads.filter(
				(thread) => thread.resolvable && !thread.resolved,
			).length;
			facets.discussions = args.unresolvedOnly
				? threads.filter((thread) => thread.resolved === false)
				: threads;
		}

		if (args.pipeline) {
			const listed = parsePipeline(
				await deps.api.get(`${base}/pipelines`, { per_page: 20 }),
			);

			if (listed === null) {
				facets.pipeline = null;
			} else {
				const jobs = await deps.api.getAll(
					`/projects/${encodeURIComponent(project)}/pipelines/${listed.id}/jobs`,
				);

				facets.pipeline = { ...listed, jobs: parseJobs(jobs.items) };
			}
		}

		return facets;
	}

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): GetMergeRequestArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		return {
			mergeRequest: nonEmptyString(args.mergeRequest) ?? "",
			diff: args.diff === true,
			discussions: args.discussions === true,
			pipeline: args.pipeline === true,
			unresolvedOnly: args.unresolvedOnly === true,
		};
	}

	/** The text the model reads, and whether any of it was cut. */
	private describe(
		mr: MergeRequestDetail,
		facets: MergeRequestFacets,
	): { readonly text: string; readonly truncated: boolean } {
		let truncated = false;

		const header = [
			`${mr.project}!${mr.iid} · ${mr.title}`,
			this.stateLine(mr),
			this.branchLine(mr),
			this.mergeLine(mr, facets.unresolved),
			mr.url === undefined ? undefined : `URL: ${mr.url}`,
		].filter((line): line is string => line !== undefined && line !== "");

		const sections: string[] = [header.join("\n")];

		if (mr.description !== undefined && mr.description !== "") {
			const cut = bounded(mr.description, MAX_DESCRIPTION_CHARS);

			if (cut.truncated) truncated = true;
			sections.push(
				[
					"Description:",
					cut.text,
					...(cut.truncated
						? [
								`… (the description was cut at ${MAX_DESCRIPTION_CHARS} characters)`,
							]
						: []),
				].join("\n"),
			);
		}

		if (facets.diffs !== undefined) {
			const block = this.diffBlock(facets.diffs);

			if (block.truncated) truncated = true;
			sections.push(block.text);
		}

		if (facets.discussions !== undefined) {
			const block = this.discussionBlock(
				facets.discussions,
				facets.unresolved ?? 0,
			);

			if (block.truncated) truncated = true;
			sections.push(block.text);
		}

		if (facets.pipeline !== undefined)
			sections.push(
				facets.pipeline === null
					? "Pipeline: none"
					: this.pipelineBlock(facets.pipeline),
			);

		return {
			text: sections
				.map((section) => section.replace(/\n+$/u, ""))
				.join("\n\n"),
			truncated,
		};
	}

	/** The state, author, reviewers and labels, one line. */
	private stateLine(mr: MergeRequestDetail): string | undefined {
		const parts: string[] = [];

		if (mr.state !== undefined)
			parts.push(
				mr.draft ? `State: ${mr.state} (draft)` : `State: ${mr.state}`,
			);
		else if (mr.draft) parts.push("Draft");

		if (mr.author !== undefined) parts.push(`Author: ${mr.author.username}`);
		if (mr.reviewers.length > 0)
			parts.push(
				`Reviewers: ${mr.reviewers.map((person) => person.username).join(", ")}`,
			);
		if (mr.labels.length > 0) parts.push(`Labels: ${mr.labels.join(", ")}`);

		return parts.length === 0 ? undefined : parts.join(" · ");
	}

	/** Where the change goes, when the answer names both ends. */
	private branchLine(mr: MergeRequestDetail): string | undefined {
		const branches = [mr.sourceBranch, mr.targetBranch].filter(
			(branch): branch is string => branch !== undefined && branch !== "",
		);

		return branches.length === 0
			? undefined
			: `Branches: ${branches.join(" → ")}`;
	}

	/** The mergeability facts GitLab reports beside the merge request. */
	private mergeLine(
		mr: MergeRequestDetail,
		unresolved: number | undefined,
	): string | undefined {
		const parts: string[] = [];

		if (mr.mergeStatus !== undefined)
			parts.push(`Merge status: ${mr.mergeStatus}`);
		if (mr.userNotesCount !== undefined)
			parts.push(`Notes: ${mr.userNotesCount}`);
		if (unresolved !== undefined) parts.push(`Unresolved: ${unresolved}`);

		return parts.length === 0 ? undefined : parts.join(" · ");
	}

	/** The changed files, then whole patches until the budget cuts the rest. */
	private diffBlock(files: readonly DiffFile[]): {
		readonly text: string;
		readonly truncated: boolean;
	} {
		if (files.length === 0) return { text: "Diff: none", truncated: false };

		const added = files.reduce((sum, file) => sum + file.added, 0);
		const removed = files.reduce((sum, file) => sum + file.removed, 0);
		const lines = [
			`Diff: ${files.length} file${files.length === 1 ? "" : "s"} (+${added} −${removed})`,
		];

		for (const file of files)
			lines.push(`- ${file.path} (+${file.added} −${file.removed})`);

		let used = 0;
		let truncated = false;

		for (const file of files) {
			if (file.patch === undefined) continue;

			const block = `--- ${file.path}\n${file.patch}`;

			if (used + block.length <= MAX_DIFF_PATCH_CHARS) {
				lines.push(block);
				used += block.length;

				continue;
			}

			// One patch larger than the whole budget is still worth its start;
			// after another patch has been printed, a half one is not.
			if (used === 0) lines.push(block.slice(0, MAX_DIFF_PATCH_CHARS));

			truncated = true;

			break;
		}

		if (truncated)
			lines.push(`… (the diff was cut at ${MAX_DIFF_PATCH_CHARS} characters)`);

		return { text: lines.join("\n"), truncated };
	}

	/** The review threads, opening note first and replies under it. */
	private discussionBlock(
		threads: readonly Discussion[],
		unresolved: number,
	): { readonly text: string; readonly truncated: boolean } {
		if (threads.length === 0)
			return { text: "Discussions: none", truncated: false };

		const shown = threads.slice(0, MAX_THREADS);
		const lines = [
			`Discussions: ${threads.length} thread${threads.length === 1 ? "" : "s"}, ${unresolved} unresolved`,
		];
		let truncated = shown.length < threads.length;

		for (const thread of shown) {
			const rendered = this.threadLines(thread);

			if (rendered.truncated) truncated = true;
			lines.push(...rendered.lines);
		}

		if (shown.length < threads.length)
			lines.push(`… (only the first ${MAX_THREADS} threads are shown)`);

		return { text: lines.join("\n"), truncated };
	}

	/** One thread: its opening note with paragraph breaks, then the replies. */
	private threadLines(thread: Discussion): {
		readonly lines: readonly string[];
		readonly truncated: boolean;
	} {
		const shown = thread.notes.slice(0, MAX_NOTES_PER_THREAD);
		const [opening, ...replies] = shown;
		const parts: string[] = [];
		const lines: string[] = [];
		let truncated = false;

		if (opening?.position !== undefined) {
			const where = this.whereOf(opening.position);

			if (where !== undefined) parts.push(where);
		}

		if (opening !== undefined) {
			if (opening.author !== undefined) parts.push(opening.author.username);

			const body = this.openingBody(opening);

			if (body.truncated) truncated = true;
			if (body.first !== "") parts.push(body.first);
			lines.push(...body.rest);
		}

		const label = `[${this.statusOf(thread)}]`;
		const head = parts.length === 0 ? label : `${label} ${parts.join(" · ")}`;

		lines.unshift(`- ${head} (id ${thread.id})`);

		for (const note of replies) {
			const reply = this.replyLine(note);

			if (reply.truncated) truncated = true;
			lines.push(reply.line);
		}

		if (shown.length < thread.notes.length)
			lines.push(`  … (${thread.notes.length - shown.length} more notes)`);

		return { lines, truncated };
	}

	/** How one thread reads: a review thread is open or closed, activity is neither. */
	private statusOf(thread: Discussion): string {
		if (!thread.resolvable) return "not resolvable";

		return thread.resolved ? "resolved" : "unresolved";
	}

	/** The opening note, keeping its paragraph breaks. */
	private openingBody(note: DiscussionNote): {
		readonly first: string;
		readonly rest: readonly string[];
		readonly truncated: boolean;
	} {
		const cut = bounded(note.body, MAX_NOTE_CHARS);
		const bodyLines = cut.text.split("\n");
		const first = bodyLines[0] ?? "";
		const rest = bodyLines
			.slice(1)
			.map((line) => (line === "" ? "" : `  ${line}`));

		if (cut.truncated) rest.push("  …");

		return { first, rest, truncated: cut.truncated };
	}

	/** One reply, on its own indented line with its author. */
	private replyLine(note: DiscussionNote): {
		readonly line: string;
		readonly truncated: boolean;
	} {
		const cut = bounded(note.body, MAX_NOTE_CHARS);
		const first = cut.text.split("\n").find((line) => line.trim() !== "") ?? "";
		const author = note.author === undefined ? "" : `${note.author.username}: `;

		return {
			line: `  > ${author}${first}${cut.truncated ? " …" : ""}`,
			truncated: cut.truncated,
		};
	}

	/** Where in the diff one note was written. */
	private whereOf(position: NotePosition): string | undefined {
		if (position.file === undefined) return undefined;

		const line = position.newLine ?? position.oldLine;

		return line === undefined ? position.file : `${position.file}:${line}`;
	}

	/** The newest pipeline and every job it ran. */
	private pipelineBlock(pipeline: PipelineSummary): string {
		const context = [pipeline.source, pipeline.ref].filter(
			(part): part is string => part !== undefined && part !== "",
		);
		const lines = [
			`Pipeline: #${pipeline.id} ${pipeline.status}${context.length === 0 ? "" : ` (${context.join(", ")})`}`,
		];

		for (const job of pipeline.jobs) lines.push(`- ${this.jobLine(job)}`);

		return lines.join("\n");
	}

	/** One job of the pipeline, with GitLab's own failure reason. */
	private jobLine(job: PipelineJob): string {
		const parts = [
			`${job.name}${job.stage === undefined ? "" : ` (${job.stage})`} ${job.status}`,
			job.failureReason,
			`id ${job.id}`,
			job.url,
		].filter((part): part is string => part !== undefined && part !== "");

		return parts.join(" · ");
	}
}

export const getMergeRequestTool = new GetMergeRequestTool();

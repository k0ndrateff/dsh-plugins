/**
 * `gitlab_get_job_log` — what a failed CI job actually printed.
 *
 * The pipeline in a merge request says which job failed, not why; the answer is
 * at the end of that job's trace. A trace carries terminal escape sequences and
 * can run to megabytes, so it is read as text, stripped with the same reader the
 * panel uses, and cut to its tail, where a failure is.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { nonEmptyString } from "dsh-integration-host/shape";
import { readJobLog } from "../../shared/ansi";
import type { PipelineJob } from "../../shared/panel";
import { GITLAB_GET_JOB_LOG_TOOL } from "../../shared/tools";
import type { GitLabApi } from "../api";
import { parseJob } from "../presentation/parse";
import { tailBounded } from "./text";

/** How much of one job's trace the model reads. */
const MAX_TRACE_CHARS = 32_000;

/** What the tool needs from the plugin. */
export interface GetJobLogDeps {
	readonly api: GitLabApi;
}

/** The arguments the model may send, after validation. */
interface GetJobLogArgs {
	readonly project: string;
	readonly jobId: number;
}

class GetJobLogTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = GITLAB_GET_JOB_LOG_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the channel to GitLab.
	 */
	create = (deps: GetJobLogDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Read one CI job of a GitLab project and the end of its trace — what a failed pipeline " +
			"actually printed. Get the job id from gitlab_get_merge_request with pipeline: true. The " +
			"answer carries at most the last 32,000 characters of the trace and says so when it cut " +
			"it: the beginning of a long log is not in the answer, so open the job's URL in GitLab " +
			"when you need it, or read another job. A job whose trace is archived or unavailable " +
			"answers 404, which means its log cannot be read, not that the job does not exist. Use " +
			"this instead of running `glab` or reading the trace through a shell.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["project", "jobId"],
			properties: {
				project: {
					type: "string",
					description: "Full project path, such as group/project.",
				},
				jobId: {
					type: "integer",
					minimum: 1,
					description:
						"The job's own id, as a pipeline or gitlab_get_merge_request lists it.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					summary: { type: "string" },
					job: { type: "object", additionalProperties: true },
					log: { type: "string" },
					truncated: { type: "boolean" },
				},
				required: ["summary", "job", "log", "truncated"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
		},
		execute: async (rawArgs) => {
			const args = this.parseArgs(rawArgs);
			const base = `/projects/${encodeURIComponent(args.project)}/jobs/${args.jobId}`;
			const job = parseJob(await deps.api.get(base));

			if (job === undefined)
				throw new Error(
					`GitLab returned no job ${args.jobId} in ${args.project}`,
				);

			const trace = readJobLog(await deps.api.text(`${base}/trace`)).trimEnd();
			const cut = tailBounded(trace, MAX_TRACE_CHARS);

			return {
				summary: this.textOf(args.project, job, cut, trace.length),
				job,
				log: cut.text,
				truncated: cut.truncated,
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): GetJobLogArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const project = nonEmptyString(args.project);
		const jobId = Number(args.jobId);

		if (project === undefined)
			throw new Error(
				'state the project path, such as "group/project", to read a job',
			);
		if (!Number.isInteger(jobId) || jobId <= 0)
			throw new Error(
				`"${String(args.jobId)}" is not a job id; pass the positive integer a pipeline lists`,
			);

		return { project, jobId };
	}

	/** The model's text: which job, what it printed, and how much of it. */
	private textOf(
		project: string,
		job: PipelineJob,
		cut: { readonly text: string; readonly truncated: boolean },
		total: number,
	): string {
		const lines = [
			`Job ${job.name}${job.stage === undefined ? "" : ` (${job.stage})`} in ${project}: ${job.status}${job.failureReason === undefined ? "" : ` · ${job.failureReason}`}`,
		];

		if (job.url !== undefined) lines.push(`URL: ${job.url}`);

		lines.push(
			cut.truncated
				? `Trace (last ${MAX_TRACE_CHARS} of ${total} characters):`
				: "Trace:",
		);

		if (cut.text !== "") lines.push(cut.text);

		return lines.join("\n");
	}
}

export const getJobLogTool = new GetJobLogTool();

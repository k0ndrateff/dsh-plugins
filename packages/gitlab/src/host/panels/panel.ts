/**
 * The side panel's view of one GitLab merge request.
 *
 * Every read goes through {@link GitLabApi}, which is the same channel the
 * agent's own tools use — the panel has no second path to GitLab. The panel
 * opens with the merge request, its diff and its discussions; the pipeline and a
 * job's trace are read only when the user asks for them, because most visits
 * never do.
 */

import type { RuntimeState } from "dsh-integration-host";
import type {
	JobLogPanel,
	MergeRequestPanel,
	PipelineJob,
	PipelinePanel,
} from "../../shared/panel";
import type { GitLabAccount } from "../account";
import type { GitLabApi } from "../api";
import {
	parseDiffFiles,
	parseDiscussions,
	parseJob,
	parseJobs,
	parseMergeRequestDetail,
	parsePipeline,
} from "../presentation/parse";

/** How many files one diff read asks for. */
const MAX_DIFF_FILES = 100;

/** How many threads and jobs one read asks for. */
const MAX_PAGE = 100;

/** How much of a job's trace is kept, in characters. */
const MAX_TRACE_CHARS = 64 * 1024;

/** The API path of one merge request. */
const mrPath = (project: string, iid: number): string =>
	`/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;

/** What the panel needs from the plugin. */
export interface PanelDeps {
	readonly api: GitLabApi;
	readonly state: RuntimeState<GitLabAccount>;
}

export class PanelApi {
	constructor(private readonly deps: PanelDeps) {}

	/**
	 * Load one merge request with the two facets the panel opens on.
	 * @param project - full path of the project.
	 * @param iid - the merge request's project-local id.
	 */
	async mergeRequest(project: string, iid: number): Promise<MergeRequestPanel> {
		const base = await this.deps.api.get(mrPath(project, iid));
		const mr = parseMergeRequestDetail(base, { project, iid });

		if (mr === undefined)
			throw new Error(`GitLab returned no merge request for ${project}!${iid}`);

		const diffs = parseDiffFiles(
			await this.deps.api.get(`${mrPath(project, iid)}/diffs`, {
				per_page: MAX_DIFF_FILES,
			}),
		);
		const discussions = parseDiscussions(
			await this.deps.api.get(`${mrPath(project, iid)}/discussions`, {
				per_page: MAX_PAGE,
			}),
		);

		return { kind: "merge_request", mr, diffs, discussions };
	}

	/**
	 * Load the merge request's newest pipeline and its jobs.
	 * @param project - full path of the project.
	 * @param iid - the merge request's project-local id.
	 */
	async pipeline(project: string, iid: number): Promise<PipelinePanel> {
		const listed = parsePipeline(
			await this.deps.api.get(`${mrPath(project, iid)}/pipelines`, {
				per_page: 20,
			}),
		);

		if (listed === null)
			return { kind: "pipeline", project, iid, pipeline: null };

		const jobs = await this.jobs(project, listed.id);

		return { kind: "pipeline", project, iid, pipeline: { ...listed, jobs } };
	}

	/**
	 * Load one job and the end of its trace.
	 * @param project - full path of the project.
	 * @param jobId - the job's own id, as the pipeline listed it.
	 */
	async jobLog(project: string, jobId: number): Promise<JobLogPanel> {
		const path = `/projects/${encodeURIComponent(project)}/jobs/${jobId}`;
		const job = parseJob(await this.deps.api.get(path));

		if (job === undefined)
			throw new Error(`GitLab returned no job ${jobId} in ${project}`);

		const trace = await this.deps.api.text(`${path}/trace`);

		// A failed job's log runs up to the failure, so the tail is what a reader
		// wants; a whole multi-megabyte trace would only cross the route to be
		// scrolled past.
		const log =
			trace.length > MAX_TRACE_CHARS
				? trace.slice(trace.length - MAX_TRACE_CHARS)
				: trace;

		return {
			kind: "job_log",
			project,
			job,
			log,
			truncated: log.length < trace.length,
		};
	}

	/** The jobs of one pipeline, by its own id. */
	private async jobs(
		project: string,
		pipelineId: number,
	): Promise<PipelineJob[]> {
		const answer = await this.deps.api.get(
			`/projects/${encodeURIComponent(project)}/pipelines/${pipelineId}/jobs`,
			{ per_page: MAX_PAGE },
		);

		return [...parseJobs(answer)];
	}
}

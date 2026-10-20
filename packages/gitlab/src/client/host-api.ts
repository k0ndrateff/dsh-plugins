/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-gitlab` with ordinary same-origin
 * requests. The transport — JSON in both directions, `{ error }` turned back
 * into a message — belongs to `dsh-integration-ui`; this is the list of calls
 * GitLab actually makes. The token is the one thing that travels the other way:
 * the user types it in the card, and the host stores it.
 */

import { createHostRequest } from "dsh-integration-ui";
import type {
	JobLogPanel,
	MergeRequestPanel,
	PipelinePanel,
	ReviewDraft,
	ReviewRequest,
} from "../shared/panel";
import type { GitLabStatus } from "../shared/status";

const request = createHostRequest("/dsh-gitlab");

/** One merge request reference as the host route spells it. */
const query = (project: string, iid: number): string =>
	`project=${encodeURIComponent(project)}&iid=${iid}`;

export const hostApi = {
	/** Read the current sign-in and connection state. */
	status: async (): Promise<GitLabStatus> => {
		return await request("/status", "GET");
	},

	/**
	 * Store one personal access token and find out whether GitLab accepts it.
	 * @returns the status as it now stands, error and all.
	 */
	saveToken: async (token: string): Promise<GitLabStatus> => {
		return await request("/token", "POST", { token });
	},

	/** Forget the stored token. */
	logout: async (): Promise<GitLabStatus> => {
		return await request("/logout", "POST");
	},

	/** Verify the stored token and re-read the account it belongs to. */
	sync: async (): Promise<GitLabStatus> => {
		return await request("/sync", "POST");
	},

	/** Everything the panel shows for one merge request. */
	mergeRequest: async (
		project: string,
		iid: number,
		signal?: AbortSignal,
	): Promise<MergeRequestPanel> => {
		return await request(
			`/mr?${query(project, iid)}`,
			"GET",
			undefined,
			signal,
		);
	},

	/** The merge request's head pipeline and its jobs, read on demand. */
	pipeline: async (
		project: string,
		iid: number,
		signal?: AbortSignal,
	): Promise<PipelinePanel> => {
		return await request(
			`/mr/pipeline?${query(project, iid)}`,
			"GET",
			undefined,
			signal,
		);
	},

	/** One job and its trace, read when the user opens it. */
	jobLog: async (
		project: string,
		id: number,
		signal?: AbortSignal,
	): Promise<JobLogPanel> => {
		return await request(
			`/mr/job?project=${encodeURIComponent(project)}&id=${id}`,
			"GET",
			undefined,
			signal,
		);
	},

	/**
	 * What one social action would send, without sending it.
	 * @returns the wording the user must approve first.
	 */
	reviewDraft: async (
		review: ReviewRequest,
	): Promise<{ draft: ReviewDraft }> => {
		return await request("/mr/review", "POST", { ...review, confirm: false });
	},

	/**
	 * Send one social action the user has already approved.
	 * @returns the merge request as GitLab now stores it.
	 */
	review: async (review: ReviewRequest): Promise<MergeRequestPanel> => {
		return await request("/mr/review", "POST", { ...review, confirm: true });
	},
};

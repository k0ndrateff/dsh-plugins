/**
 * Building the merge request list request.
 *
 * The card's list and the agent's list tool ask GitLab the same question, so the
 * path and the filters are built once here: a second builder is how the two
 * surfaces would start disagreeing about what "waiting for my review" means.
 */

import type { RuntimeState } from "dsh-integration-host";
import type { GitLabAccount } from "../account";
import type { Param } from "../api";

/** The most rows one list page may ask GitLab for. */
export const MR_LIST_PAGE_SIZE = 25;

/** What narrows one merge request list. */
export interface MergeRequestListQuery {
	readonly scope?: string;
	readonly project?: string;
	readonly group?: string;
	readonly state?: string;
	readonly search?: string;
	readonly labels?: string;
	readonly author?: string;
	readonly reviewer?: string;
	readonly limit?: number;
	/** Which page of the list to read; the first unless the model says otherwise. */
	readonly page?: number;
}

/**
 * Where a list is read from: one project, one group, or everything visible.
 * @param query - the project or group the caller narrowed to, if any.
 */
export const listPathOf = (query: MergeRequestListQuery): string => {
	if (query.project !== undefined)
		return `/projects/${encodeURIComponent(query.project)}/merge_requests`;
	if (query.group !== undefined)
		return `/groups/${encodeURIComponent(query.group)}/merge_requests`;

	return "/merge_requests";
};

/**
 * What narrows a list, in GitLab's own query vocabulary.
 *
 * "Waiting for my review" is not one of the global `scope` values; GitLab
 * spells it as a reviewer filter, so that is what it is asked for.
 * @param state - the connection's facts, which name the signed-in user.
 * @param query - the filters the caller asked for.
 * @throws when a review-requested list runs before the account is known.
 */
export const listParamsOf = (
	state: RuntimeState<GitLabAccount>,
	query: MergeRequestListQuery,
): Record<string, Param> => {
	const params: Record<string, Param> = {
		per_page: query.limit ?? 10,
		// The schema says "omit to include any state", so an omitted state asks for
		// every state rather than quietly narrowing to open requests.
		state: query.state ?? "all",
	};

	if (query.search !== undefined) params.search = query.search;
	if (query.labels !== undefined) params.labels = query.labels;
	if (query.author !== undefined) params.author_username = query.author;
	if (query.page !== undefined) params.page = query.page;

	if (query.scope === "review_requested") {
		const username = query.reviewer ?? state.facts?.username;

		if (username === undefined)
			throw new Error("the GitLab account is not known yet; run /gitlab sync");

		params.reviewer_username = username;

		return params;
	}

	if (query.reviewer !== undefined) params.reviewer_username = query.reviewer;
	else if (query.scope !== undefined) params.scope = query.scope;

	return params;
};

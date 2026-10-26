/**
 * The wire names both halves of the GitLab plugin agree on.
 *
 * The host half registers these tools and the browser half keys its card and
 * tool rows on the names it draws, so a string repeated in two bundles cannot
 * drift away from the tool the agent actually calls.
 */

/** List merge requests as rows the agent can read. */
export const GITLAB_LIST_MERGE_REQUESTS_TOOL = "gitlab_list_merge_requests";

/** Read one merge request, with its diff, discussions and pipeline on request. */
export const GITLAB_GET_MERGE_REQUEST_TOOL = "gitlab_get_merge_request";

/** Read the end of one CI job's trace. */
export const GITLAB_GET_JOB_LOG_TOOL = "gitlab_get_job_log";

/** Read any GitLab REST endpoint with GET. */
export const GITLAB_READ_TOOL = "gitlab_read";

/** Show merge requests, findings or failed jobs to the user as a card. */
export const GITLAB_PRESENT_TOOL = "gitlab_present";

/** Perform one social action behind the confirmation gate. */
export const GITLAB_REVIEW_TOOL = "gitlab_review";

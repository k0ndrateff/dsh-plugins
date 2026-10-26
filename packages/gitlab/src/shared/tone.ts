/**
 * How GitLab's own words map onto the UI kit's tag palette.
 *
 * Both the card and the panel show the same states — a merge request's `opened`,
 * a job's `failed` — and neither invents its own colours for them, so the
 * vocabulary lives in one place. An unknown word gets the neutral tone rather
 * than a guess.
 */

import type { TagTone } from "@deepseek-ai/dsh-client-ui-primitives";

/** The tone one merge request state is drawn with. */
export function mrStateTone(state: string | undefined): TagTone {
	if (state === "opened") return "success";
	if (state === "merged") return "info";
	if (state === "locked") return "warning";

	return "neutral";
}

/** A merge request state as a person reads it. */
export function mrStateLabel(state: string | undefined): string {
	if (state === "opened") return "Open";
	if (state === "merged") return "Merged";
	if (state === "closed") return "Closed";
	if (state === "locked") return "Locked";

	return state ?? "unknown";
}

/** GitLab's mergeability words as a person reads them. */
export function mergeStatusLabel(status: string): string {
	if (status === "mergeable") return "Mergeable";
	if (status === "cannot_be_merged" || status === "conflict")
		return "Conflicts";
	if (status === "checking" || status === "unchecked") return "Checking";
	if (status === "broken") return "Broken";

	return status.replaceAll("_", " ");
}

/** A CI job status as a person reads it. */
export function jobStatusLabel(status: string): string {
	if (status === "success") return "Passed";
	if (status === "running") return "Running";
	if (status === "pending") return "Pending";
	if (status === "failed") return "Failed";
	if (status === "canceled") return "Canceled";
	if (status === "manual") return "Manual";

	return status.replaceAll("_", " ");
}

/** GitLab's own `failure_reason` values, as a person reads them. */
const FAILURE_REASON_LABELS: Readonly<Record<string, string>> = {
	script_failure: "the job script failed",
	runner_system_failure: "the runner failed",
	runner_unsupported: "the runner is unsupported",
	stuck_or_timeout_failure: "the job got stuck or timed out",
	job_execution_timeout: "the job timed out",
	missing_dependency_failure: "a dependency was missing",
	unmet_prerequisites: "its prerequisites were not met",
	api_failure: "GitLab's API failed",
	archived_failure: "the job is archived",
	data_integrity_failure: "the job data was corrupt",
	scheduler_failure: "the scheduler failed",
	unknown_failure: "GitLab gave no further reason",
};

/** One job's failure reason as a person reads it, rather than an enum. */
export function jobFailureReasonLabel(reason: string): string {
	return FAILURE_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

/** The tone one CI job status is drawn with. */
export function jobTone(status: string): TagTone {
	if (status === "success") return "success";
	if (status === "failed") return "danger";
	if (status === "running" || status === "pending") return "info";
	if (status === "manual" || status === "canceled") return "warning";

	return "neutral";
}

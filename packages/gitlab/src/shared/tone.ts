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

/** The tone one CI job status is drawn with. */
export function jobTone(status: string): TagTone {
	if (status === "success") return "success";
	if (status === "failed") return "danger";
	if (status === "running" || status === "pending") return "info";
	if (status === "manual" || status === "canceled") return "warning";

	return "neutral";
}

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

/** The tone one CI job status is drawn with. */
export function jobTone(status: string): TagTone {
	if (status === "success") return "success";
	if (status === "failed") return "danger";
	if (status === "running" || status === "pending") return "info";
	if (status === "manual" || status === "canceled") return "warning";

	return "neutral";
}

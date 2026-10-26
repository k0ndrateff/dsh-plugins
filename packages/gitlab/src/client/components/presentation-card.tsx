/**
 * How one GitLab card draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; this says
 * what the heading counts, which rows go in the list, and what GitLab's own
 * extras — the scope a list ran, the merge request findings belong to — add
 * around them. One card can hold merge requests, findings, or failed jobs,
 * because the three answer the same question ("what is waiting for me?") in
 * different units.
 */

import type { CardProvider } from "dsh-integration-ui";
import type { GitLabPresentation } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { FindingItem } from "./finding-item";
import { JobItem } from "./job-item";
import { MergeRequestItem } from "./mr-item";

/**
 * What the card's heading says about its contents.
 * @param presentation - the card being drawn.
 * @returns "3 merge requests", or the same plus "2 of 40" when more matched.
 */
const countLabel = (presentation: GitLabPresentation): string => {
	let mergeRequests = 0;
	let findings = 0;
	let jobs = 0;

	for (const item of presentation.items) {
		if (item.kind === "merge_request") mergeRequests += 1;
		else if (item.kind === "finding") findings += 1;
		else jobs += 1;
	}

	const parts: string[] = [];

	if (mergeRequests > 0)
		parts.push(
			`${mergeRequests} merge request${mergeRequests === 1 ? "" : "s"}`,
		);
	if (findings > 0)
		parts.push(`${findings} finding${findings === 1 ? "" : "s"}`);
	if (jobs > 0) parts.push(`${jobs} failed job${jobs === 1 ? "" : "s"}`);

	const label = parts.join(" · ");
	const total = presentation.total;

	return total === undefined || total <= presentation.items.length
		? label
		: `${label} of ${total}`;
};

/** The GitLab card, as the shared tail draws it. */
export const gitlabCard: CardProvider<GitLabPresentation> = {
	callId: (presentation) => presentation.callId,
	title: (presentation) => presentation.title,
	count: countLabel,
	length: (presentation) => presentation.items.length,
	layout: (presentation) => presentation.layout,
	items: (presentation) =>
		presentation.items.map((item) => {
			if (item.kind === "merge_request")
				return (
					<MergeRequestItem
						key={`mr-${item.mergeRequest.project}!${item.mergeRequest.iid}`}
						mergeRequest={item.mergeRequest}
					/>
				);

			if (item.kind === "finding")
				return (
					<FindingItem
						key={`finding-${item.finding.discussionId}`}
						finding={item.finding}
					/>
				);

			return <JobItem key={`job-${item.job.id}`} job={item.job} />;
		}),
	meta: (presentation) => {
		const hasMeta =
			presentation.query !== undefined ||
			presentation.filters !== undefined ||
			presentation.subject !== undefined;

		if (!hasMeta) return null;

		return (
			<div className={styles.cardMeta}>
				{presentation.query === undefined ? null : (
					<span
						className={styles.caption}
					>{`Showing: ${presentation.query}`}</span>
				)}

				{presentation.filters === undefined ? null : (
					<span className={styles.caption}>
						{`Filters: ${presentation.filters.join(" · ")}`}
					</span>
				)}

				{presentation.subject === undefined ? null : (
					<span className={styles.caption}>{presentation.subject}</span>
				)}
			</div>
		);
	},
};

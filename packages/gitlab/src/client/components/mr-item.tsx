/**
 * One merge request on a card.
 *
 * The row is the link: the reference anchors a stretched overlay, so a click
 * anywhere on the row opens the panel — or GitLab, for a modified click, and
 * whenever this build has no panel at all.
 */

import { Chip, Facts } from "dsh-integration-ui";
import type { MergeRequestCard } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { openTarget, RowLink } from "./row-link";

interface Props {
	mergeRequest: MergeRequestCard;
}

/** One merge request, as a card row shows it. */
export const MergeRequestItem = ({ mergeRequest }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<RowLink
				url={mergeRequest.url}
				label={`${mergeRequest.project}!${mergeRequest.iid}`}
				onOpen={(event) => {
					openTarget(event, {
						project: mergeRequest.project,
						iid: mergeRequest.iid,
					});
				}}
			/>

			<span className={styles.itemTitle}>{mergeRequest.title}</span>

			{mergeRequest.draft ? <Chip tone="warning" value="draft" /> : null}
		</div>

		<Facts
			layout="inline"
			items={[
				{ label: "State", value: mergeRequest.state },
				{ label: "Author", value: mergeRequest.author },
				{
					label: "Reviewers",
					value:
						mergeRequest.reviewers === undefined ||
						mergeRequest.reviewers.length === 0
							? undefined
							: mergeRequest.reviewers.join(", "),
				},
				{ label: "Pipeline", value: mergeRequest.pipeline },
				{ label: "Unresolved", value: mergeRequest.unresolved },
				{ label: "Notes", value: mergeRequest.notes },
				{
					label: "Branches",
					value:
						mergeRequest.sourceBranch === undefined ||
						mergeRequest.targetBranch === undefined
							? undefined
							: `${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`,
				},
			]}
		/>
	</li>
);

/**
 * One merge request on a card.
 *
 * The row is the link: the reference anchors a stretched overlay, so a click
 * anywhere on the row opens the panel — or GitLab, for a modified click, and
 * whenever this build has no panel at all.
 */

import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { Fact } from "dsh-integration-ui";
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

			{mergeRequest.draft ? <Tag tone="warning">draft</Tag> : null}
		</div>

		<div className={styles.badges}>
			<Fact label="State" value={mergeRequest.state} />
			<Fact label="Author" value={mergeRequest.author} />
			<Fact
				label="Reviewers"
				value={
					mergeRequest.reviewers === undefined ||
					mergeRequest.reviewers.length === 0
						? undefined
						: mergeRequest.reviewers.join(", ")
				}
			/>
			<Fact label="Pipeline" value={mergeRequest.pipeline} />
			<Fact label="Unresolved" value={mergeRequest.unresolved} />
			<Fact label="Notes" value={mergeRequest.notes} />
			<Fact
				label="Branches"
				value={
					mergeRequest.sourceBranch === undefined ||
					mergeRequest.targetBranch === undefined
						? undefined
						: `${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`
				}
			/>
		</div>
	</li>
);

/**
 * The Overview tab: what the merge request is, and the one approval action.
 *
 * Approving is a social action — it stands in somebody's merge request under the
 * user's name — so it goes through the same confirmation as a comment: the
 * button asks the host what it would do, and the panel shows that before Send.
 */

import { Button, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { Fact } from "dsh-integration-ui";
import type { ReactNode } from "react";
import type { MergeRequestDetail } from "../../shared/panel";
import { mrStateTone } from "../../shared/tone";
import type { ReviewState } from "../sidebar/review";
import * as styles from "../styles/styles.css";
import { Prose, peopleText, Section, whenText } from "./blocks";

interface Props {
	readonly mr: MergeRequestDetail;
	readonly review: ReviewState;
}

/** The branch pair, as GitLab shows it in the merge request header. */
const Branches = ({ mr }: { mr: MergeRequestDetail }) => {
	if (mr.sourceBranch === undefined && mr.targetBranch === undefined)
		return null;

	return (
		<Section title="Branches">
			<div className={styles.branchRow}>
				{mr.sourceBranch === undefined ? null : (
					<span className={styles.branch}>{mr.sourceBranch}</span>
				)}

				<span className={styles.caption}>into</span>

				{mr.targetBranch === undefined ? null : (
					<span className={styles.branch}>{mr.targetBranch}</span>
				)}
			</div>
		</Section>
	);
};

/** Everything the panel shows about the merge request itself. */
export const MrOverview = ({ mr, review }: Props): ReactNode => {
	const reviewers = peopleText(mr.reviewers);
	const assignees = peopleText(mr.assignees);

	return (
		<>
			<div className={styles.badges}>
				<Tag tone={mrStateTone(mr.state)}>{mr.state ?? "unknown"}</Tag>

				{mr.draft ? <Tag tone="warning">Draft</Tag> : null}
				{mr.hasConflicts ? <Tag tone="danger">Conflicts</Tag> : null}
				{mr.mergeStatus === undefined ? null : (
					<Tag tone="neutral">{mr.mergeStatus}</Tag>
				)}

				<Fact label="Author" value={mr.author?.username} />
				<Fact label="Reviewers" value={reviewers ?? "none"} />
				<Fact label="Assignees" value={assignees} />
				<Fact
					label="Updated"
					value={
						mr.updatedAt === undefined ? undefined : whenText(mr.updatedAt)
					}
				/>
				<Fact label="Notes" value={mr.userNotesCount} />
			</div>

			<Branches mr={mr} />

			{mr.labels.length === 0 ? null : (
				<Section title="Labels">
					<div className={styles.badges}>
						{mr.labels.map((label) => (
							<Tag key={label} tone="outline">
								{label}
							</Tag>
						))}
					</div>
				</Section>
			)}

			<Section title="Description">
				{mr.description === undefined || mr.description.trim() === "" ? (
					<span className={styles.caption}>No description.</span>
				) : (
					<Prose text={mr.description} />
				)}
			</Section>

			<Section title="Review">
				<div className={styles.actions}>
					<Button
						size="sm"
						variant="outline"
						disabled={review.busy}
						onClick={() => {
							void review.propose({
								project: mr.project,
								iid: mr.iid,
								action: "approve",
							});
						}}
					>
						Approve
					</Button>

					<Button
						size="sm"
						variant="ghost"
						disabled={review.busy}
						onClick={() => {
							void review.propose({
								project: mr.project,
								iid: mr.iid,
								action: "unapprove",
							});
						}}
					>
						Remove approval
					</Button>
				</div>

				<span className={styles.caption}>
					An approval is posted under your name, so it is confirmed first.
				</span>
			</Section>

			<Section title="Open">
				<div className={styles.actions}>
					{mr.url === undefined ? (
						<span className={styles.caption}>
							GitLab named no web address for this merge request.
						</span>
					) : (
						<a
							className={styles.link}
							href={mr.url}
							target="_blank"
							rel="noreferrer"
						>
							Open in GitLab
						</a>
					)}
				</div>
			</Section>
		</>
	);
};

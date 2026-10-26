/**
 * The Overview tab: what the merge request is, and the one applicable approval
 * action.
 *
 * Approving is a social action — it stands in somebody's merge request under the
 * user's name — so it goes through the same confirmation as a comment: the
 * button asks the host what it would do, and the panel shows that before Send.
 *
 * Which of the two approval actions exists is a fact, not a guess: the host reads
 * GitLab's own approvals, so a reader who has not approved is not offered "Remove
 * approval", and one who has is not offered a no-op "Approve". When GitLab refuses
 * the approvals read, the panel says so and shows both actions rather than
 * pretending either is applicable.
 */

import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { Chip, Facts, type PanelActions } from "dsh-integration-ui";
import type { ReactNode } from "react";
import type {
	MergeRequestApprovals,
	MergeRequestDetail,
	PanelTarget,
} from "../../shared/panel";
import { mergeStatusLabel, mrStateLabel, mrStateTone } from "../../shared/tone";
import type { ReviewState } from "../sidebar/review";
import * as styles from "../styles/styles.css";
import { Prose, peopleText, Section, whenText } from "./blocks";
import { ConfirmRow } from "./confirm-row";

interface Props {
	readonly mr: MergeRequestDetail;
	readonly review: ReviewState;
	readonly actions: PanelActions<PanelTarget>;
	/** Who approved, when GitLab answered the approvals read. */
	readonly approvals?: MergeRequestApprovals;
	/** Why the read failed, when it did. */
	readonly approvalsError?: string;
}

/**
 * What the approval state is, in one sentence.
 * @param approvals - GitLab's answer, when it gave one.
 * @param error - why it gave none, when it refused.
 */
function approvalText(
	approvals: MergeRequestApprovals | undefined,
	error: string | undefined,
): string {
	if (approvals === undefined)
		return error === undefined
			? "GitLab did not report who approved this merge request."
			: "GitLab did not report approvals for this merge request.";

	const people = approvals.approvedBy.map((person) => person.username);
	const required =
		approvals.required === undefined || approvals.required === 0
			? ""
			: ` ${approvals.required} required.`;

	if (approvals.approvedByViewer)
		return people.length <= 1
			? "Approved by you."
			: `Approved by you and ${people.length - 1} more.${required}`;

	if (people.length === 0) return `No approvals yet.${required}`;

	return `Approved by ${people.join(", ")}.${
		approvals.left === undefined || approvals.left === 0
			? required
			: ` ${approvals.left} more needed.`
	}`;
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
export const MrOverview = ({
	mr,
	review,
	actions,
	approvals,
	approvalsError,
}: Props): ReactNode => {
	const reviewers = peopleText(mr.reviewers);
	const assignees = peopleText(mr.assignees);
	const draft =
		review.draft !== null &&
		(review.draft.action === "approve" || review.draft.action === "unapprove")
			? review.draft
			: null;
	const failure =
		review.error !== undefined &&
		(review.error.place.action === "approve" ||
			review.error.place.action === "unapprove")
			? review.error.message
			: undefined;
	const notice =
		review.notice !== undefined &&
		(review.notice.place.action === "approve" ||
			review.notice.place.action === "unapprove")
			? review.notice.message
			: undefined;
	const busy = actions.busy || review.busy || review.sending;

	return (
		<>
			<div className={styles.badges}>
				<Chip tone={mrStateTone(mr.state)} value={mrStateLabel(mr.state)} />

				{mr.draft ? <Chip tone="warning" value="Draft" /> : null}
				{mr.hasConflicts ? <Chip tone="danger" value="Conflicts" /> : null}
				{mr.mergeStatus === undefined ? null : (
					<Chip tone="neutral" value={mergeStatusLabel(mr.mergeStatus)} />
				)}
				{approvals?.approved === true ? (
					<Chip tone="success" value="Approved" />
				) : null}
			</div>

			<Facts
				items={[
					{ label: "Author", value: mr.author?.username },
					{ label: "Reviewers", value: reviewers ?? "none" },
					{ label: "Assignees", value: assignees },
					{
						label: "Updated",
						value:
							mr.updatedAt === undefined ? undefined : whenText(mr.updatedAt),
					},
					{ label: "Notes", value: mr.userNotesCount },
				]}
			/>

			<Branches mr={mr} />

			{mr.labels.length === 0 ? null : (
				<Section title="Labels">
					<div className={styles.badges}>
						{mr.labels.map((label) => (
							<Chip key={label} tone="outline" value={label} />
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
					{approvals === undefined ? (
						<>
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
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
								disabled={busy}
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
						</>
					) : approvals.approvedByViewer ? (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
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
					) : (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
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
					)}
				</div>

				<span className={styles.caption}>
					{approvalText(approvals, approvalsError)}
				</span>

				{draft === null && failure !== undefined ? (
					<p className={styles.error} role="alert">
						{failure}
					</p>
				) : null}

				{draft === null ? null : (
					<ConfirmRow
						draft={draft}
						busy={busy}
						sending={review.sending}
						failure={failure}
						onSend={() => {
							review.send(actions);
						}}
						onCancel={review.cancel}
					/>
				)}

				{notice === undefined ? null : (
					<span className={styles.notice} role="status">
						{notice}
					</span>
				)}
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

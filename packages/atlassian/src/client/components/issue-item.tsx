/**
 * One Jira issue on a card.
 *
 * The row is the link: the title anchors a stretched overlay, so the whole card
 * opens the issue. The type is a coloured chip rather than a "Type: …" badge,
 * because a colour is what makes a mixed list scannable at a glance.
 */

import { Chip, Facts } from "dsh-integration-ui";
import type { IssueCard } from "../../shared/meta";
import { issueTypeTone, priorityTone } from "../../shared/tone";
import { openPanel, wantsBrowser } from "../sidebar/open";
import * as styles from "../styles/styles.css";

interface Props {
	issue: IssueCard;
}

export const IssueItem = ({ issue }: Props) => {
	const title = [issue.key, issue.summary]
		.filter((part) => part !== undefined && part !== "")
		.join(" · ");

	return (
		<li className={styles.item}>
			<div className={styles.itemHead}>
				<Chip value={issue.type} tone={issueTypeTone(issue.type)} />

				{issue.url === undefined ? (
					<span>{title}</span>
				) : (
					<a
						className={`${styles.link} ${styles.itemLink}`}
						href={issue.url}
						target="_blank"
						rel="noreferrer"
						onClick={(event) => {
							// The panel, when this build has one; the browser for a
							// modified click, or when it does not.
							if (wantsBrowser(event)) return;
							if (openPanel({ kind: "issue", key: issue.key }))
								event.preventDefault();
						}}
					>
						{title}
					</a>
				)}
			</div>

			{issue.description === undefined ? null : (
				<p className={styles.itemText}>{issue.description}</p>
			)}

			<Facts
				layout="inline"
				items={[
					{ label: "Status", value: issue.status },
					{
						label: "Priority",
						value:
							issue.priority === undefined ? undefined : (
								<Chip
									value={issue.priority}
									tone={priorityTone(issue.priority)}
								/>
							),
					},
					{ label: "Assignee", value: issue.assignee },
					{ label: "Estimate", value: issue.estimate },
				]}
			/>
		</li>
	);
};

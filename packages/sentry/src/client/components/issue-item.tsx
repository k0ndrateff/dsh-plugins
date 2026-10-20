/**
 * One Sentry issue on a card.
 *
 * The row is the link: the issue id anchors a stretched overlay, so a click
 * anywhere on the row opens the panel — or Sentry, for a modified click, and
 * whenever this build has no panel at all.
 */

import type { MouseEvent } from "react";
import type { IssueCard } from "../../shared/meta";
import { openPanel, wantsBrowser } from "../sidebar/open";
import * as styles from "../styles/styles.css";
import { Fact } from "./fact";

interface Props {
	issue: IssueCard;
}

/**
 * The row's click target: the id, linked out and opening the panel.
 *
 * Sentry does not always name a URL for an issue, and the row must still be
 * clickable then; a button carries the same overlay as the anchor.
 */
const IdLink = ({ issue }: Props) => {
	const open = (event: MouseEvent<HTMLElement>): void => {
		if (wantsBrowser(event)) return;
		if (openPanel({ id: issue.id })) event.preventDefault();
	};

	if (issue.url === undefined)
		return (
			<button
				type="button"
				className={`${styles.link} ${styles.itemLink} ${styles.rowButton}`}
				onClick={open}
			>
				{issue.id}
			</button>
		);

	return (
		<a
			className={`${styles.link} ${styles.itemLink}`}
			href={issue.url}
			target="_blank"
			rel="noreferrer"
			onClick={open}
		>
			{issue.id}
		</a>
	);
};

/** One issue, as a card row shows it. */
export const IssueItem = ({ issue }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<IdLink issue={issue} />
			<span className={styles.itemTitle}>{issue.title}</span>
		</div>

		<div className={styles.badges}>
			<Fact label="Status" value={issue.status} />
			<Fact label="Assignee" value={issue.assignee} />
			<Fact label="Events" value={issue.events} />
			<Fact label="Users" value={issue.users} />
			<Fact label="Last seen" value={issue.lastSeen} />
		</div>
	</li>
);

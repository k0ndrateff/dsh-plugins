/**
 * One Sentry issue on a card.
 *
 * The row is the link: the issue id anchors a stretched overlay, so a click
 * anywhere on the row opens the panel — or Sentry, for a modified click, and
 * whenever this build has no panel at all.
 *
 * A card is a durable record, so a time on it must be a timestamp: the host
 * resolves Sentry's "2 minutes ago" against the moment the answer was read, and
 * this row formats it in the reader's locale. The link's own name carries the
 * title as well as the id, because a screen reader's list of links would
 * otherwise be a column of ids.
 */

import { Facts } from "dsh-integration-ui";
import type { MouseEvent } from "react";
import { isWebUrl } from "../../shared/link";
import type { IssueCard } from "../../shared/meta";
import { openPanel, wantsBrowser } from "../sidebar/open";
import * as styles from "../styles/styles.css";

interface Props {
	issue: IssueCard;
	/** The organization the card was read from, so the panel opens the same one. */
	organization?: string;
}

/** One moment as the reader's own locale and time zone write it. */
const whenText = (value: string): string => {
	const time = Date.parse(value);

	return Number.isNaN(time)
		? value
		: new Date(time).toLocaleString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				timeZoneName: "short",
			});
};

/** The issue's own words for a screen reader's link list: id and title. */
const linkName = (issue: IssueCard): string =>
	issue.title === "" || issue.title === issue.id
		? issue.id
		: `${issue.id} · ${issue.title}`;

/**
 * The row's click target: the id, linked out and opening the panel.
 *
 * Sentry does not always name a URL for an issue, and the row must still be
 * clickable then; a button carries the same overlay as the anchor.
 */
const IdLink = ({ issue, organization }: Props) => {
	const open = (event: MouseEvent<HTMLElement>): void => {
		if (wantsBrowser(event)) return;
		if (openPanel({ id: issue.id, organization })) event.preventDefault();
	};

	if (!isWebUrl(issue.url))
		return (
			<button
				type="button"
				className={`${styles.link} ${styles.itemLink} ${styles.rowButton}`}
				aria-label={linkName(issue)}
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
			aria-label={linkName(issue)}
			onClick={open}
		>
			{issue.id}
		</a>
	);
};

/** One issue, as a card row shows it. */
export const IssueItem = ({ issue, organization }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<IdLink issue={issue} organization={organization} />
			<span className={styles.itemTitle}>{issue.title}</span>
		</div>

		<Facts
			layout="inline"
			items={[
				{ label: "Status", value: issue.status },
				{ label: "Assignee", value: issue.assignee },
				{ label: "Events", value: issue.events },
				{ label: "Users", value: issue.users },
				{
					label: "Last seen",
					value:
						issue.lastSeen === undefined ? undefined : whenText(issue.lastSeen),
				},
			]}
		/>
	</li>
);

/**
 * How one Sentry card draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; this says
 * what the heading counts, which items go in the list, and what Sentry's own
 * extras — the query the search ran, the commit it suspects — add around them.
 */

import type { CardProvider } from "dsh-integration-ui";
import { isWebUrl } from "../../shared/link";
import type { SentryPresentation } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { IssueItem } from "./issue-item";
import { SuspectRow } from "./suspect-row";

/**
 * What the card's heading says about its contents.
 * @param presentation - the card being drawn.
 * @returns "3 issues", or "3 of 42 issues" when more matched than are shown.
 */
const countLabel = (presentation: SentryPresentation): string => {
	const count = presentation.issues.length;
	const total = presentation.total;

	return total === undefined || total <= count
		? `${count} issue${count === 1 ? "" : "s"}`
		: `${count} of ${total} issues`;
};

/** The Sentry card, as the shared tail draws it. */
export const sentryCard: CardProvider<SentryPresentation> = {
	callId: (presentation) => presentation.callId,
	title: (presentation) => presentation.title,
	count: countLabel,
	length: (presentation) => presentation.issues.length,
	layout: (presentation) => presentation.layout,
	items: (presentation) =>
		presentation.issues.map((issue) => (
			<IssueItem
				key={issue.id}
				issue={issue}
				organization={presentation.organization}
			/>
		)),
	meta: (presentation) => {
		const hasMeta =
			presentation.query !== undefined ||
			presentation.dashboardUrl !== undefined ||
			presentation.organization !== undefined;

		if (!hasMeta) return null;

		return (
			<div className={styles.cardMeta}>
				{presentation.organization === undefined ? null : (
					<span className={styles.caption}>{presentation.organization}</span>
				)}

				{presentation.query === undefined ? null : (
					<code className={styles.query}>{presentation.query}</code>
				)}

				{!isWebUrl(presentation.dashboardUrl) ? null : (
					<a
						className={styles.link}
						href={presentation.dashboardUrl}
						target="_blank"
						rel="noreferrer"
					>
						All results in Sentry
					</a>
				)}
			</div>
		);
	},
	footer: (presentation) =>
		presentation.suspect === undefined ? null : (
			<SuspectRow suspect={presentation.suspect} label="Suspect commit" />
		),
};

/**
 * The suspect commit Sentry names for an issue.
 *
 * One component for both surfaces that show it — the card under an answer and
 * the side panel — so the short sha, the message, the author, and the tracker
 * key the message mentions are read the same way in each.
 */

import { Fact } from "dsh-integration-ui";
import type { SuspectCommit } from "../../shared/meta";
import * as styles from "../styles/styles.css";

/** How much of the sha the row spells out; the rest is in Sentry. */
const SHORT_SHA = 12;

interface Props {
	suspect: SuspectCommit;
	/** The heading above the row, omitted where the card's own head is enough. */
	label?: string;
}

export const SuspectRow = ({ suspect, label }: Props) => (
	<div className={styles.suspect}>
		{label === undefined ? null : (
			<span className={styles.suspectLabel}>{label}</span>
		)}

		<code className={styles.mono}>{suspect.sha.slice(0, SHORT_SHA)}</code>

		{suspect.message === undefined ? null : (
			<span className={styles.suspectText}>{suspect.message}</span>
		)}

		{suspect.author === undefined ? null : (
			<span className={styles.caption}>{suspect.author}</span>
		)}

		{suspect.issueKey === undefined ? null : (
			<Fact label="Tracker" value={suspect.issueKey} />
		)}
	</div>
);

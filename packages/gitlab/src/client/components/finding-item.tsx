/**
 * One review finding on a card.
 *
 * A finding is a discussion thread somebody opened on a line of the diff, and
 * the row says what a reviewer asked, where, and whether it is closed yet — the
 * list the "go through the review comments" workflow works from. It opens the
 * panel on its discussions rather than on the merge request's overview, because
 * that is where the thread lives.
 */

import { Chip, Facts } from "dsh-integration-ui";
import type { FindingCard } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { openTarget, RowLink } from "./row-link";

interface Props {
	finding: FindingCard;
}

/** Where in the diff the finding was written. */
const whereText = (finding: FindingCard): string => {
	if (finding.file === undefined) return finding.discussionId;
	if (finding.line === undefined) return finding.file;

	const side = finding.lineSide === "old" ? " (removed)" : "";

	return `${finding.file}:${finding.line}${side}`;
};

/** One review finding, as a card row shows it. */
export const FindingItem = ({ finding }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<RowLink
				url={finding.url}
				label={whereText(finding)}
				onOpen={(event) => {
					openTarget(event, {
						project: finding.project,
						iid: finding.iid,
						tab: "discussions",
						discussionId: finding.discussionId,
					});
				}}
			/>

			<Chip
				tone={finding.resolved ? "success" : "warning"}
				value={finding.resolved ? "resolved" : "unresolved"}
			/>
		</div>

		<span className={styles.findingBody}>{finding.body}</span>

		<Facts
			layout="inline"
			items={[{ label: "Author", value: finding.author }]}
		/>
	</li>
);

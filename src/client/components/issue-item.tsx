import type { IssueCard } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { Badge } from "./badge";

interface Props {
	issue: IssueCard;
	/** Dense rows drop all but the status, so a long list stays scannable. */
	dense?: boolean;
}

export const IssueItem = ({ issue, dense = false }: Props) => {
	const title = [issue.key, issue.summary]
		.filter((part) => part !== undefined && part !== "")
		.join(" · ");

	return (
		<li className={styles.item}>
			<div className={styles.itemHead}>
				{issue.url === undefined ? (
					<span>{title}</span>
				) : (
					<a
						className={styles.link}
						href={issue.url}
						target="_blank"
						rel="noreferrer"
					>
						{title}
					</a>
				)}
			</div>

			<div className={styles.badges}>
				<Badge label="Status" value={issue.status} />

				{dense ? null : (
					<>
						<Badge label="Priority" value={issue.priority} />
						<Badge label="Assignee" value={issue.assignee} />
						<Badge label="Type" value={issue.type} />
					</>
				)}
			</div>
		</li>
	);
};

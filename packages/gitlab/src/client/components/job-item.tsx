/**
 * One failed CI job on a card.
 *
 * The row names the job, the stage it ran in, and GitLab's own reason for the
 * failure, and it opens the panel on the pipeline — where the job's log is one
 * click away.
 */

import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { JobCard } from "../../shared/meta";
import {
	jobFailureReasonLabel,
	jobStatusLabel,
	jobTone,
} from "../../shared/tone";
import * as styles from "../styles/styles.css";
import { openTarget, RowLink } from "./row-link";

interface Props {
	job: JobCard;
}

/** One failed job, as a card row shows it. */
export const JobItem = ({ job }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<RowLink
				url={job.url}
				label={job.name}
				onOpen={(event) => {
					openTarget(event, {
						project: job.project,
						iid: job.iid,
						tab: "pipeline",
						jobId: job.id,
					});
				}}
			/>

			<Tag tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</Tag>

			{job.stage === undefined ? null : <Tag tone="neutral">{job.stage}</Tag>}
		</div>

		{job.failureReason === undefined ? null : (
			<span className={styles.caption}>
				{jobFailureReasonLabel(job.failureReason)}
			</span>
		)}
	</li>
);

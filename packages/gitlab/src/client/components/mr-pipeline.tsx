/**
 * The Pipeline tab: the merge request's head pipeline, its jobs, and a log.
 *
 * The panel does not read this with the merge request, because it is two more
 * calls and most visits never open it. It loads when the tab is shown, and a
 * job's trace loads when the job is opened — a failed job's log is where the
 * answer usually is, and it can be hundreds of kilobytes, so it is read only
 * when somebody asks for it.
 */

import { Button, StateDot, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	asJobLogPanel,
	asPipelinePanel,
	type JobLogPanel,
	type PanelTarget,
	type PipelineJob,
	type PipelinePanel,
} from "../../shared/panel";
import { jobStatusLabel, jobTone } from "../../shared/tone";
import { readJobLog } from "../ansi";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";
import { messageOf } from "../text";
import { Section } from "./blocks";

/** What the tab currently knows. */
type Load =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly panel: PipelinePanel }
	| { readonly status: "error"; readonly message: string };

/** One job's trace, with the escapes the server sent read out of it. */
const Log = ({ entry }: { entry: JobLogPanel }) => (
	<Section title={`Log · ${entry.job.name}`}>
		<pre className={styles.log}>{readJobLog(entry.log)}</pre>

		{entry.truncated ? (
			<span className={styles.caption}>
				The log is cut to its last 64 KiB. Open the job in GitLab for the
				beginning.
			</span>
		) : null}
	</Section>
);

interface JobProps {
	readonly job: PipelineJob;
	readonly busy: boolean;
	onOpen(): void;
}

/** One job: what it is, how it ended, and the way into its trace. */
const Job = ({ job, busy, onOpen }: JobProps) => (
	<li className={styles.job}>
		<StateDot
			state={
				job.status === "failed"
					? "error"
					: job.status === "running"
						? "ongoing"
						: job.status === "success"
							? "done"
							: "idle"
			}
		/>

		<span className={styles.jobName}>{job.name}</span>

		{job.stage === undefined ? null : <Tag tone="neutral">{job.stage}</Tag>}

		<Tag tone={jobTone(job.status)}>{jobStatusLabel(job.status)}</Tag>

		{job.failureReason === undefined ? null : (
			<span className={styles.caption}>{job.failureReason}</span>
		)}

		<Button size="sm" variant="ghost" disabled={busy} onClick={onOpen}>
			Log
		</Button>

		{job.url === undefined ? null : (
			<a
				className={styles.link}
				href={job.url}
				target="_blank"
				rel="noreferrer"
			>
				Open
			</a>
		)}
	</li>
);

/** The merge request's head pipeline and its jobs. */
export const MrPipeline = ({ target }: { target: PanelTarget }): ReactNode => {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [log, setLog] = useState<JobLogPanel | null>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | undefined>(undefined);

	useEffect(() => {
		const controller = new AbortController();

		hostApi
			.pipeline(target.project, target.iid, controller.signal)
			.then((answer) => {
				const panel = asPipelinePanel(answer);

				if (panel === undefined)
					throw new Error(
						"the host answered with a pipeline this version cannot draw",
					);
				if (!controller.signal.aborted) setLoad({ status: "ready", panel });
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setLoad({ status: "error", message: messageOf(error) });
			});

		return () => {
			controller.abort();
		};
	}, [target.project, target.iid]);

	if (load.status === "loading")
		return <span className={styles.caption}>Loading the pipeline…</span>;

	if (load.status === "error")
		return <span className={styles.error}>{load.message}</span>;

	const pipeline = load.panel.pipeline;

	if (pipeline === null)
		return (
			<Section title="Pipeline">
				<span className={styles.caption}>
					This merge request has no pipeline yet.
				</span>
			</Section>
		);

	const failed = pipeline.jobs.filter((job) => job.status === "failed");

	return (
		<>
			<Section title="Pipeline">
				<div className={styles.badges}>
					<Tag tone={jobTone(pipeline.status)}>
						{jobStatusLabel(pipeline.status)}
					</Tag>

					<span className={styles.caption}>{`#${pipeline.id}`}</span>

					{pipeline.ref === undefined ? null : (
						<span className={styles.branch}>{pipeline.ref}</span>
					)}

					{pipeline.source === undefined ? null : (
						<span className={styles.caption}>{pipeline.source}</span>
					)}

					{pipeline.url === undefined ? null : (
						<a
							className={styles.link}
							href={pipeline.url}
							target="_blank"
							rel="noreferrer"
						>
							Open in GitLab
						</a>
					)}
				</div>

				{failed.length === 0 ? (
					<span className={styles.caption}>No failed jobs.</span>
				) : (
					<span className={styles.caption}>
						{`${failed.length} failed job${failed.length === 1 ? "" : "s"} of ${pipeline.jobs.length}.`}
					</span>
				)}
			</Section>

			<Section title={`Jobs (${pipeline.jobs.length})`}>
				<ul className={styles.list} data-layout="list">
					{pipeline.jobs.map((job) => (
						<Job
							key={job.id}
							job={job}
							busy={busy}
							onOpen={() => {
								setBusy(true);
								setFailure(undefined);

								hostApi
									.jobLog(target.project, job.id)
									.then((answer) => {
										const entry = asJobLogPanel(answer);

										if (entry === undefined)
											throw new Error(
												"the host answered with a log this version cannot draw",
											);

										setLog(entry);
									})
									.catch((error: unknown) => {
										setFailure(messageOf(error));
									})
									.finally(() => {
										setBusy(false);
									});
							}}
						/>
					))}
				</ul>
			</Section>

			{log === null ? null : <Log entry={log} />}

			{failure === undefined ? null : (
				<span className={styles.error}>{failure}</span>
			)}
		</>
	);
};

/**
 * The checks card: one run, under the closing text of its turn.
 *
 * Each check keeps its own line and, beneath it, the places it complained about.
 * Clicking one opens that file in the harness's own panel. The file opens at its
 * beginning: this seat's `openFile` takes a path and nothing more, so a position
 * would be dropped — the tool row, inside the tool group, sits in the seat that
 * also takes a line.
 */

import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
	type CheckFailure,
	type CheckResult,
	checkLabel,
	durationLabel,
	locationLabel,
} from "../../shared/checks";
import { type CheckedRun, selectRuns } from "../conversation/card-definition";
import * as styles from "../styles/styles.css";

/** How many failures one card lists; the rest are counted. */
const CARD_FAILURES = 20;

/** One failure, clickable when it names a file. */
const Failure = ({
	failure,
	openFile,
}: {
	failure: CheckFailure;
	openFile: (path: string) => void;
}) => {
	const file = failure.file;

	if (file === undefined)
		return (
			<span className={styles.failureStatic}>
				<span className={styles.message}>{failure.message}</span>
			</span>
		);

	const where = locationLabel(failure);

	return (
		<button
			type="button"
			className={styles.failure}
			title={`Open ${where ?? file}`}
			onClick={() => openFile(file)}
		>
			<span className={styles.where}>{where}</span>
			<span className={styles.message}>{failure.message}</span>
		</button>
	);
};

/** One check: its line, its failures, and the output nothing parsed. */
const Run = ({
	run,
	openFile,
}: {
	run: CheckResult;
	openFile: (path: string) => void;
}) => (
	<li className={styles.run}>
		<div className={styles.runHead}>
			<span
				className={run.status === "passed" ? styles.markOk : styles.markBad}
			>
				{run.status === "passed" ? "✓" : "✗"}
			</span>
			<span className={styles.runName}>{run.name}</span>
			<span className={styles.runLabel}>{checkLabel(run)}</span>
			<span className={styles.duration}>{durationLabel(run.durationMs)}</span>
		</div>

		{run.failures.length === 0 ? null : (
			<ul className={styles.failures}>
				{run.failures.slice(0, CARD_FAILURES).map((failure, index) => (
					<li key={`${failure.file ?? ""}:${failure.line ?? 0}:${index}`}>
						<Failure failure={failure} openFile={openFile} />
					</li>
				))}
				{run.failures.length > CARD_FAILURES ? (
					<li className={styles.more}>
						… {run.failures.length - CARD_FAILURES} more
					</li>
				) : null}
			</ul>
		)}

		{run.output === undefined ? null : (
			<pre className={styles.output}>{run.output}</pre>
		)}
	</li>
);

/** One card: how the run went, then each check. */
const Card = ({
	run,
	openFile,
}: {
	run: CheckedRun;
	openFile: (path: string) => void;
}) => {
	const passed = run.checks.filter((check) => check.status === "passed").length;

	return (
		<section className={styles.card} data-devkit-card={run.callId}>
			<div className={styles.head}>
				<span className={styles.title}>checks</span>
				<span className={styles.count}>
					{passed} of {run.checks.length} passed
				</span>
			</div>

			<ul className={styles.runs}>
				{run.checks.map((check) => (
					<Run key={check.name} run={check} openFile={openFile} />
				))}
			</ul>
		</section>
	);
};

/**
 * Render every run one completed turn reported.
 * @param props - the closing turn, its sequence, and the file opener.
 * @returns the cards, or null for a turn that ran no check.
 */
export const ChecksTail = (
	props: PropsRuntime<"conversation.chat.turnTail">,
) => {
	const matched = selectRuns(props);

	if (matched === null) return null;

	return (
		<div>
			{matched.runs.map((run) => (
				<Card key={run.callId} run={run} openFile={props.openFile} />
			))}
		</div>
	);
};

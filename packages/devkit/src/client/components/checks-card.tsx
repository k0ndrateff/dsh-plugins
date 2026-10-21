/**
 * The checks card: one run, under the closing text of its turn.
 *
 * Each check keeps its own line and, beneath it, the places it complained about.
 * Clicking one opens that file in the harness's own panel. The file opens at its
 * beginning: this seat's `openFile` takes a path and nothing more, so a position
 * would be dropped — the tool row, inside the tool group, sits in the seat that
 * also takes a line.
 *
 * The card's chrome — its heading, its count, and the list its checks sit in —
 * belongs to `dsh-integration-ui`; what is devkit's is what one check looks like.
 */

import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { CardProvider } from "dsh-integration-ui";
import {
	type CheckFailure,
	type CheckResult,
	type ChecksCard,
	checkLabel,
	durationLabel,
	locationLabel,
} from "../../shared/checks";
import * as styles from "../styles/styles.css";

/** How many failures one card lists; the rest are counted. */
const CARD_FAILURES = 20;

/** What the turn-tail seat hands a card that needs more than its payload. */
type TurnTailOwner = PropsRuntime<"conversation.chat.turnTail">;

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

/**
 * One check: its line, its failures, and — when it did not pass — its output.
 *
 * A passing check's log is the length of the command's own chatter, and the
 * reader came for the recipe's verdict; the log stays in the session for whoever
 * wants it. A failing check's output is the opposite: it is the part the parser
 * could not turn into a file and a line, so it is the only place the reason is.
 */
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

		{run.status === "passed" || run.output === undefined ? null : (
			<pre className={styles.output}>{run.output}</pre>
		)}
	</li>
);

/** How one run of checks draws itself. */
export const checksCard: CardProvider<ChecksCard, TurnTailOwner> = {
	callId: (run) => run.callId,
	title: () => "Project checks",
	count: (run) => {
		const passed = run.checks.filter(
			(check) => check.status === "passed",
		).length;

		return `${passed} of ${run.checks.length} passed`;
	},
	length: (run) => run.checks.length,
	layout: () => "list",
	items: (run, owner) =>
		run.checks.map((check) => (
			<Run key={check.name} run={check} openFile={owner.openFile} />
		)),
};

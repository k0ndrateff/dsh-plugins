/**
 * The checks card: one run, under the closing text of its turn.
 *
 * Each check keeps its own line and, beneath it, the places it complained about.
 * Clicking one opens that file in the harness's own panel, and the panel opens
 * at its beginning: this seat's `openFile` takes a path and nothing more, so a
 * position would be dropped. The card therefore promises only the file, shows
 * the position as text, and offers a copy of `path:line` — the reader who wants
 * the line in another tool gets it exactly, and the one who clicks is not
 * surprised. A warning is marked as one, and a cancelled run as cancelled: both
 * are drawn differently from a failure, because the reader's next move differs.
 *
 * The card's chrome — its heading, its count, and the list its checks sit in —
 * belongs to `dsh-integration-ui`; what is devkit's is what one check looks like.
 */

import { writeClipboard } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { CardProvider } from "dsh-integration-ui";
import { useState } from "react";
import {
	type CheckFailure,
	type CheckResult,
	type ChecksCard,
	checkLabel,
	durationLabel,
	locationLabel,
	MAX_CARD_FAILURES,
} from "../../shared/checks";
import * as styles from "../styles/styles.css";

/** How many failures one card lists before it offers the rest. */
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
	const where = locationLabel(failure);
	const severity =
		failure.severity === "warning" ? (
			<span className={styles.severityWarning}>warning</span>
		) : (
			<span className={styles.severityError}>error</span>
		);
	const rule =
		failure.rule === undefined ? null : (
			<span className={styles.rule}>{failure.rule}</span>
		);

	if (file === undefined)
		return (
			<span className={styles.failureStatic}>
				{severity}
				{rule}
				<span className={styles.message}>{failure.message}</span>
			</span>
		);

	return (
		<span className={styles.failureStatic}>
			{severity}
			{rule}

			<button
				type="button"
				className={styles.failure}
				title={`Open ${file}`}
				onClick={() => openFile(file)}
			>
				<span className={styles.where}>{where}</span>
				<span className={styles.message}>{failure.message}</span>
			</button>

			{where === undefined ? null : (
				<button
					type="button"
					className={styles.copy}
					title={`Copy ${where}`}
					onClick={() => void writeClipboard(where)}
				>
					Copy
				</button>
			)}
		</span>
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
}) => {
	const [expanded, setExpanded] = useState(false);
	const shown = expanded ? run.failures : run.failures.slice(0, CARD_FAILURES);
	const total = run.failureTotal ?? run.failures.length;
	const kept = run.failures.length;

	return (
		<li className={styles.run}>
			<div className={styles.runHead}>
				<span
					className={
						run.status === "passed"
							? styles.markOk
							: run.status === "cancelled"
								? styles.markCancelled
								: styles.markBad
					}
				>
					{run.status === "passed"
						? "✓"
						: run.status === "cancelled"
							? "−"
							: "✗"}
				</span>
				<span className={styles.runName}>{run.name}</span>
				<span className={styles.runLabel}>{checkLabel(run)}</span>
				<span className={styles.duration}>{durationLabel(run.durationMs)}</span>
			</div>

			{run.failures.length === 0 ? null : (
				<ul className={styles.failures}>
					{shown.map((failure, index) => (
						<li key={`${failure.file ?? ""}:${failure.line ?? 0}:${index}`}>
							<Failure failure={failure} openFile={openFile} />
						</li>
					))}

					{expanded || total <= CARD_FAILURES ? null : (
						<li>
							<button
								type="button"
								className={styles.showAll}
								onClick={() => {
									setExpanded(true);
								}}
							>
								{`Show all ${Math.min(total, kept)}${total > kept ? ` of ${total}` : ""}`}
							</button>
						</li>
					)}

					{expanded && total > kept ? (
						<li className={styles.more}>
							… {total - kept} more that the card does not keep (
							{MAX_CARD_FAILURES} is its cap)
						</li>
					) : null}
				</ul>
			)}

			{run.status === "passed" || run.output === undefined ? null : (
				<pre className={styles.output}>{run.output}</pre>
			)}
		</li>
	);
};

/** How one run of checks draws itself. */
export const checksCard: CardProvider<ChecksCard, TurnTailOwner> = {
	callId: (run) => run.callId,
	title: () => "Project checks",
	count: (run) => {
		const passed = run.checks.filter(
			(check) => check.status === "passed",
		).length;

		const cancelled = run.checks.filter(
			(check) => check.status === "cancelled",
		).length;
		const base = `${passed} of ${run.checks.length} passed`;

		return cancelled === 0 ? base : `${base} · ${cancelled} cancelled`;
	},
	length: (run) => run.checks.length,
	layout: () => "list",
	// The directory matters in a monorepo: the session's project may be one
	// package, and "Project checks" alone does not say whose.
	meta: (run) =>
		run.project === undefined ? null : (
			<span className={styles.caption}>{run.project}</span>
		),
	items: (run, owner) =>
		run.checks.map((check) => (
			<Run key={check.name} run={check} openFile={owner.openFile} />
		)),
};

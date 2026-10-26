/**
 * The one confirmation the panel shows before a social action leaves.
 *
 * What it renders is not a summary of the action but the action itself: the note
 * exactly as GitLab will receive it. A comment in somebody else's merge request
 * cannot be taken back, so the wording is on screen, in full, before Send exists
 * as a choice.
 *
 * The row renders where the action was asked for — under the thread, or under
 * the composer — so a long list of discussions does not separate the click from
 * its confirmation. It also carries the sending state and the failure, which is
 * what lets a failed write keep the text and turn Send into the retry.
 */

import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { ReviewDraft } from "../../shared/panel";
import * as styles from "../styles/styles.css";

interface Props {
	readonly draft: ReviewDraft;
	/** Whether a write is already running; every control is locked while it is. */
	readonly busy: boolean;
	/** Whether this draft is being sent right now. */
	readonly sending: boolean;
	/** The failure of the last attempt, when it failed. */
	readonly failure?: string;
	/** Where the thread is, when the draft touches one. */
	readonly threadLabel?: string;
	onSend(): void;
	onCancel(): void;
}

/** What the caption says the action will change. */
const captionOf = (draft: ReviewDraft, threadLabel?: string): string => {
	if (draft.body !== undefined)
		return "This is exactly what GitLab will receive.";

	const thread = threadLabel ?? draft.discussionId;

	if (draft.action === "resolve" || draft.action === "unresolve")
		return draft.action === "resolve"
			? `Changes only one flag: ${thread ?? "this thread"} becomes resolved.`
			: `Changes only one flag: ${thread ?? "this thread"} becomes open again.`;

	return `GitLab records this on ${draft.subject}; it cannot be undone from here.`;
};

export const ConfirmRow = ({
	draft,
	busy,
	sending,
	failure,
	threadLabel,
	onSend,
	onCancel,
}: Props): ReactNode => {
	const row = useRef<HTMLElement>(null);

	// The draft appears where the user clicked, so bringing it into view is the
	// difference between "the reply was sent" and "nothing happened" on a long list.
	useEffect(() => {
		row.current?.scrollIntoView({ block: "nearest" });
	}, []);

	return (
		<section
			ref={row}
			className={styles.draft}
			data-review-draft={draft.action}
			aria-label={`Confirm: ${draft.summary}`}
		>
			<span className={styles.panelSectionTitle}>
				{`${draft.summary} · ${draft.subject}`}
			</span>

			{draft.body === undefined ? null : (
				<pre className={styles.draftText}>{draft.body}</pre>
			)}

			<span className={styles.caption}>{captionOf(draft, threadLabel)}</span>

			{failure === undefined ? null : (
				<p className={styles.error} role="alert">
					{failure}
				</p>
			)}

			<div className={styles.actions}>
				<Button size="sm" variant="primary" disabled={busy} onClick={onSend}>
					{sending ? "Sending…" : failure === undefined ? "Send" : "Try again"}
				</Button>

				<Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</section>
	);
};

/**
 * The one confirmation the panel shows before a social action leaves.
 *
 * What it renders is not a summary of the action but the action itself: the note
 * exactly as GitLab will receive it. A comment in somebody else's merge request
 * cannot be taken back, so the wording is on screen, in full, before Send exists
 * as a choice.
 */

import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import type { ReviewDraft } from "../../shared/panel";
import * as styles from "../styles/styles.css";

interface Props {
	readonly draft: ReviewDraft;
	/** Whether a write is already running; every control is locked while it is. */
	readonly busy: boolean;
	onSend(): void;
	onCancel(): void;
}

export const ConfirmRow = ({
	draft,
	busy,
	onSend,
	onCancel,
}: Props): ReactNode => (
	<section className={styles.draft} data-review-draft={draft.action}>
		<span className={styles.panelSectionTitle}>
			{`${draft.summary} · ${draft.subject}`}
		</span>

		{draft.body === undefined ? null : (
			<pre className={styles.draftText}>{draft.body}</pre>
		)}

		<span className={styles.caption}>
			{draft.discussionId === undefined
				? "This is exactly what GitLab will receive."
				: `Thread: ${draft.discussionId}`}
		</span>

		<div className={styles.actions}>
			<Button size="sm" variant="primary" disabled={busy} onClick={onSend}>
				Send
			</Button>

			<Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
				Cancel
			</Button>
		</div>
	</section>
);

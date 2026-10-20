/**
 * The confirmation the panel keeps while a social action is pending.
 *
 * Every write the panel offers is a social one — a comment, a reply, a resolved
 * thread, an approval — so none of them is sent straight from a click. A tab
 * asks the host what the action would post, the host answers with the exact
 * wording, and this holds it until the user presses Send. The gate itself is the
 * host's `ReviewService`; this only carries its answer.
 */

import type { PanelActions } from "dsh-integration-ui";
import { useCallback, useState } from "react";
import {
	asReviewDraft,
	type PanelTarget,
	type ReviewDraft,
	type ReviewRequest,
} from "../../shared/panel";
import { hostApi } from "../host-api";
import { messageOf } from "../text";

/** What one panel's tabs share while a social action is being written. */
export interface ReviewState {
	/** The wording waiting for the user's approval, if any. */
	readonly draft: ReviewDraft | null;
	/** Whether the host is being asked what the action would send. */
	readonly busy: boolean;
	/** The last failure, cleared when a new draft is asked for. */
	readonly error: string | undefined;
	/** Ask the host what one action would post, without posting it. */
	propose(request: ReviewRequest): Promise<void>;
	/** Throw the pending wording away. */
	cancel(): void;
	/** Send the pending wording, which the user has just read. */
	send(actions: PanelActions<PanelTarget>): void;
}

/**
 * Hold the pending confirmation of one panel.
 * @returns the state, and the three operations the tabs drive it with.
 */
export const useReview = (): ReviewState => {
	const [draft, setDraft] = useState<ReviewDraft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const propose = useCallback(async (request: ReviewRequest): Promise<void> => {
		setBusy(true);
		setError(undefined);

		try {
			const answer = await hostApi.reviewDraft(request);
			const parsed = asReviewDraft(answer.draft);

			if (parsed === undefined)
				throw new Error(
					"the host answered with a draft this version cannot show",
				);

			setDraft(parsed);
		} catch (failure) {
			setError(messageOf(failure));
		} finally {
			setBusy(false);
		}
	}, []);

	const cancel = useCallback((): void => {
		setDraft(null);
		setError(undefined);
	}, []);

	const send = useCallback(
		(actions: PanelActions<PanelTarget>): void => {
			const pending = draft;
			if (pending === null) return;

			setDraft(null);
			setError(undefined);

			// The host answers with the merge request as GitLab now stores it, so the
			// panel renders the new thread rather than assuming one appeared.
			actions.run(
				async (target) =>
					await hostApi.review({
						project: target.project,
						iid: target.iid,
						action: pending.action,
						...(pending.body === undefined ? {} : { body: pending.body }),
						...(pending.discussionId === undefined
							? {}
							: { discussionId: pending.discussionId }),
					}),
			);
		},
		[draft],
	);

	return { draft, busy, error, propose, cancel, send };
};

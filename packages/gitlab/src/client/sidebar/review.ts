/**
 * The confirmation the panel keeps while a social action is pending.
 *
 * Every write the panel offers is a social one — a comment, a reply, a resolved
 * thread, an approval — so none of them is sent straight from a click. A tab
 * asks the host what the action would post, the host answers with the exact
 * wording, and this holds it until the user presses Send. The gate itself is the
 * host's `ReviewService`; this only carries its answer.
 *
 * Each request remembers where it was made, so the panel can show the draft, the
 * failure, and the later confirmation beside the thread the user clicked rather
 * than in a header far above it. The draft is dropped only after the host
 * answered that the write succeeded: a failed write leaves the text and the Send
 * button in place, which is what makes retrying possible.
 */

import type { PanelActions } from "dsh-integration-ui";
import { useCallback, useState } from "react";
import {
	asReviewDraft,
	type PanelTarget,
	type ReviewAction,
	type ReviewDraft,
	type ReviewRequest,
} from "../../shared/panel";
import { hostApi } from "../host-api";
import { messageOf } from "../text";

/** Which action, and in which thread, a pending or failed write belongs to. */
export interface ReviewPlace {
	readonly action: ReviewAction;
	readonly discussionId?: string;
}

/** One failed social action, with the thread it was asked for in. */
export interface ReviewFailure {
	readonly message: string;
	readonly place: ReviewPlace;
}

/** One successful social action, for the short confirmation after it lands. */
export interface ReviewNotice {
	readonly message: string;
	readonly place: ReviewPlace;
}

/** What one social action says after GitLab accepted it. */
const DONE_TEXT: Readonly<Record<ReviewAction, string>> = {
	comment: "Comment posted.",
	reply: "Reply posted.",
	resolve: "Discussion resolved.",
	unresolve: "Discussion reopened.",
	approve: "Approved.",
	unapprove: "Approval removed.",
};

/** The place a review request belongs to, as the panel addresses a thread. */
const placeOf = (request: {
	readonly action: ReviewAction;
	readonly discussionId?: string;
}): ReviewPlace => ({
	action: request.action,
	...(request.discussionId === undefined
		? {}
		: { discussionId: request.discussionId }),
});

/** What one panel's tabs share while a social action is being written. */
export interface ReviewState {
	/** The wording waiting for the user's approval, if any. */
	readonly draft: ReviewDraft | null;
	/** Whether the host is being asked what the action would send. */
	readonly busy: boolean;
	/** Whether the approved draft is on its way to GitLab. */
	readonly sending: boolean;
	/** The last failure, cleared when a new draft is asked for. */
	readonly error: ReviewFailure | undefined;
	/** The last success, so the thread that changed says so. */
	readonly notice: ReviewNotice | undefined;
	/**
	 * Ask the host what one action would post, without posting it.
	 * @returns whether the draft arrived; false leaves the caller's editor open.
	 */
	propose(request: ReviewRequest): Promise<boolean>;
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
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<ReviewFailure | undefined>(undefined);
	const [notice, setNotice] = useState<ReviewNotice | undefined>(undefined);

	const propose = useCallback(
		async (request: ReviewRequest): Promise<boolean> => {
			const place = placeOf(request);

			setBusy(true);
			setError(undefined);
			setNotice(undefined);

			try {
				const answer = await hostApi.reviewDraft(request);
				const parsed = asReviewDraft(answer.draft);

				if (parsed === undefined)
					throw new Error(
						"the host answered with a draft this version cannot show",
					);

				setDraft(parsed);

				return true;
			} catch (failure) {
				setError({ message: messageOf(failure), place });

				return false;
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	const cancel = useCallback((): void => {
		setDraft(null);
		setError(undefined);
		setNotice(undefined);
	}, []);

	const send = useCallback(
		(actions: PanelActions<PanelTarget>): void => {
			const pending = draft;
			if (pending === null || sending) return;

			const place = placeOf(pending);

			setSending(true);
			setError(undefined);
			setNotice(undefined);

			// The host answers with the merge request as GitLab now stores it, so the
			// panel renders the new thread rather than assuming one appeared. The draft
			// is dropped only once that answer is in: a failed write keeps the text, and
			// Send stays there as the retry.
			actions.run(async (target) => {
				try {
					const answer = await hostApi.review({
						project: target.project,
						iid: target.iid,
						action: pending.action,
						...(pending.body === undefined ? {} : { body: pending.body }),
						...(pending.discussionId === undefined
							? {}
							: { discussionId: pending.discussionId }),
					});

					setDraft(null);
					setNotice({ message: DONE_TEXT[pending.action], place });

					return answer;
				} catch (failure) {
					setError({ message: messageOf(failure), place });

					// The shared body refetches after a failed write anyway; answering with
					// the current document keeps the failure beside the thread instead of
					// repeating it in the header as well.
					return await hostApi.mergeRequest(target.project, target.iid);
				} finally {
					setSending(false);
				}
			});
		},
		[draft, sending],
	);

	return { draft, busy, sending, error, notice, propose, cancel, send };
};

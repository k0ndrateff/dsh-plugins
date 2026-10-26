/**
 * The social actions, and the confirmation gate in front of them.
 *
 * A comment, a reply, a resolved thread, an approval — these change somebody
 * else's merge request and cannot be taken back, so they are never sent by
 * accident. One implementation serves both callers: the side panel, which shows
 * the draft and sends it when the user presses Send, and the `gitlab_review`
 * tool, which answers the model with the same draft until it is called with
 * `confirm`. Neither caller decides the policy itself.
 *
 * The draft is not decoration: it carries the exact text that will be posted, so
 * what the user reads before sending is what GitLab receives.
 */

import { asRecord, pickNumber } from "dsh-mcp-oauth";
import type { ReviewAction, ReviewDraft, ReviewRequest } from "../shared/panel";
import type { GitLabApi } from "./api";

/** One line naming what an action does, before it is done. */
const SUMMARY: Readonly<Record<ReviewAction, string>> = {
	comment: "Comment on the merge request",
	reply: "Reply in the discussion thread",
	resolve: "Resolve the discussion thread",
	unresolve: "Reopen the discussion thread",
	approve: "Approve the merge request",
	unapprove: "Remove your approval",
};

/**
 * A request this integration will not send, as opposed to a failure behind it.
 *
 * A comment with no text is the caller's mistake, and both callers answer it as
 * one: the route with a bad request, the tool with the same sentence.
 */
export class ReviewRefusal extends Error {}

/** What one submitted action did, or would do. */
export interface ReviewOutcome {
	/** Whether GitLab was asked to do it. */
	readonly performed: boolean;
	readonly draft: ReviewDraft;
	/** What GitLab answered, when the action was performed. */
	readonly result?: string;
}

/** The note id GitLab answered with, as a parenthetical, when it named one. */
function idText(answer: unknown): string {
	const id = pickNumber(asRecord(answer), "id");

	return id === undefined ? "" : ` (id ${id})`;
}

/** A note GitLab would refuse, because it would run a quick action instead. */
const QUICK_ACTION = /^\s*\//mu;

/** How long a performed action is remembered, so an accidental repeat is caught. */
const REPEAT_WINDOW_MS = 60_000;

/** Whether a failure left it unknown whether GitLab performed the action. */
const AMBIGUOUS_FAILURE =
	/timed? ?out|abort|fetch failed|network|econnreset|socket|terminated/iu;

/** One action already performed, kept to refuse an identical repeat. */
interface PerformedAction {
	readonly key: string;
	readonly at: number;
}

/** The reason inside an unknown thrown value, as a plain sentence. */
const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * One merge request reference as both halves spell it.
 * @param project - full path of the project.
 * @param iid - the merge request's project-local id.
 */
export const subjectOf = (project: string, iid: number): string =>
	`${project}!${iid}`;

export class ReviewService {
	/** The last action this process sent, so the same confirm twice is caught. */
	private performed: PerformedAction | undefined;

	constructor(private readonly api: GitLabApi) {}

	/**
	 * Perform one social action, or describe it when it was not confirmed.
	 * @param request - what to do, and to which merge request.
	 * @param confirm - whether the user has seen and approved this exact draft.
	 * @returns the draft, and what GitLab answered when the action was performed.
	 * @throws when the action was already sent moments ago, or when GitLab's
	 *   answer was ambiguous enough that repeating could duplicate it.
	 */
	async submit(
		request: ReviewRequest,
		confirm: boolean,
	): Promise<ReviewOutcome> {
		const draft = this.draft(request);

		if (!confirm) return { performed: false, draft };

		const key = this.keyOf(request, draft);
		const last = this.performed;

		if (
			last !== undefined &&
			last.key === key &&
			Date.now() - last.at < REPEAT_WINDOW_MS
		)
			throw new ReviewRefusal(
				`this exact ${request.action} was already sent to ${draft.subject} seconds ago; GitLab would receive it twice. Re-read the merge request before repeating it.`,
			);

		try {
			const result = await this.perform(request, draft);

			this.performed = { key, at: Date.now() };

			return { performed: true, draft, result };
		} catch (error) {
			if (AMBIGUOUS_FAILURE.test(reasonOf(error)))
				throw new Error(
					`GitLab did not confirm the ${request.action} on ${draft.subject}: ${reasonOf(error)} The action may already have been performed — re-read the merge request before calling again, or it will be posted twice.`,
				);

			throw error;
		}
	}

	/** What makes one action identical to another: the thread and the exact text. */
	private keyOf(request: ReviewRequest, draft: ReviewDraft): string {
		return [
			request.action,
			draft.subject,
			draft.discussionId ?? "",
			draft.body ?? "",
		].join("\u0000");
	}

	/**
	 * Describe one action in the words the user reads before it is sent.
	 * @param request - what to do, and to which merge request.
	 * @throws when the action is missing a field GitLab requires.
	 */
	draft(request: ReviewRequest): ReviewDraft {
		const subject = subjectOf(request.project, request.iid);
		const body = request.body?.trim();
		const discussionId = request.discussionId?.trim();

		if (request.action === "comment" || request.action === "reply") {
			if (body === undefined || body === "")
				throw new ReviewRefusal(`a ${request.action} needs its text`);

			if (QUICK_ACTION.test(body))
				throw new ReviewRefusal(
					"GitLab refuses a note whose line starts with a slash, because it would run a quick action",
				);
		}

		if (
			request.action === "reply" &&
			(discussionId === undefined || discussionId === "")
		)
			throw new ReviewRefusal("a reply needs the discussion it answers");

		if (
			(request.action === "resolve" || request.action === "unresolve") &&
			(discussionId === undefined || discussionId === "")
		)
			throw new ReviewRefusal(
				`a ${request.action} needs the discussion it names`,
			);

		return {
			action: request.action,
			summary: SUMMARY[request.action],
			subject,
			...(body === undefined || body === "" ? {} : { body }),
			...(discussionId === undefined || discussionId === ""
				? {}
				: { discussionId }),
		};
	}

	/** Send one validated action, and say what GitLab answered. */
	private async perform(
		request: ReviewRequest,
		draft: ReviewDraft,
	): Promise<string> {
		const base = `/projects/${encodeURIComponent(request.project)}/merge_requests/${request.iid}`;

		if (request.action === "approve") {
			await this.api.post(`${base}/approve`);

			return "Approved.";
		}

		if (request.action === "unapprove") {
			await this.api.post(`${base}/unapprove`);

			return "Approval removed.";
		}

		if (request.action === "comment") {
			const note = await this.api.post(`${base}/notes`, { body: draft.body });

			return `Note posted${idText(note)}.`;
		}

		const discussionId = draft.discussionId;

		if (discussionId === undefined)
			throw new ReviewRefusal(
				`a ${request.action} needs the discussion it names`,
			);

		const thread = `${base}/discussions/${encodeURIComponent(discussionId)}`;

		if (request.action === "resolve" || request.action === "unresolve") {
			await this.api.put(thread, { resolved: request.action === "resolve" });

			return request.action === "resolve"
				? "Discussion resolved."
				: "Discussion reopened.";
		}

		const note = await this.api.post(`${thread}/notes`, { body: draft.body });

		return `Reply posted${idText(note)}.`;
	}
}

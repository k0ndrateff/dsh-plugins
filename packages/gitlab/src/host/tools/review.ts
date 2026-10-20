/**
 * `gitlab_review` — the tool behind every social action.
 *
 * A comment, a reply, a resolved thread, an approval: each changes somebody
 * else's merge request and cannot be taken back. So the tool never sends one
 * straight away. Without `confirm` it answers with the exact text that would be
 * posted and the instruction to ask the user; only a second call, made after the
 * user agreed, sends it.
 *
 * The gate itself lives in {@link ReviewService}, which the side panel drives
 * too, so the two surfaces cannot disagree about what "confirmed" means.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { isReviewAction, type ReviewRequest } from "../../shared/panel";
import { parseReference } from "../presentation/parse";
import type { ReviewService } from "../review";

/** What the tool needs from the plugin. */
export interface ReviewToolDeps {
	readonly review: ReviewService;
}

/** The arguments the model may send, after validation. */
interface ReviewArgs {
	readonly reference: string;
	readonly action: string;
	readonly body: string | undefined;
	readonly discussionId: string | undefined;
	readonly confirm: boolean;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

class ReviewTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = "gitlab_review";

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the one implementation of the confirmation gate.
	 */
	create = (deps: ReviewToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Comment on a GitLab merge request, reply in a review thread, resolve or reopen a thread, " +
			"or approve a merge request. These are social actions on somebody else's work, so the tool " +
			"does not send them by itself: call it once to get the exact text that would be posted, show " +
			"that to the user, and call it again with confirm: true only after they agree. Never set " +
			"confirm without the user's explicit approval of that wording.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["mergeRequest", "action"],
			properties: {
				mergeRequest: {
					type: "string",
					description:
						'The merge request, as a reference such as "group/project!12" or its URL.',
				},
				action: {
					type: "string",
					enum: [
						"comment",
						"reply",
						"resolve",
						"unresolve",
						"approve",
						"unapprove",
					],
					description:
						"comment posts a new top-level note; reply answers an existing thread; resolve and " +
						"unresolve close or reopen one; approve and unapprove set your own approval.",
				},
				body: {
					type: "string",
					description:
						"The note's text, in Markdown. Required by comment and reply. A line may not start " +
						"with a slash, because GitLab would run it as a quick action.",
				},
				discussionId: {
					type: "string",
					description:
						"The thread to answer or resolve, as a card or the panel spells it. Required by " +
						"reply, resolve and unresolve.",
				},
				confirm: {
					type: "boolean",
					description:
						"Send it for real. Set this only after the user approved the exact text this tool " +
						"answered with on the first call.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					performed: { type: "boolean" },
					summary: { type: "string" },
					action: { type: "string" },
					subject: { type: "string" },
					body: { type: "string" },
					discussionId: { type: "string" },
					result: { type: "string" },
				},
				required: ["performed", "summary", "action", "subject"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
		},
		execute: async (rawArgs) => {
			const args = this.parseArgs(rawArgs);
			const reference = parseReference(args.reference);

			if (reference === undefined)
				throw new Error(
					`"${args.reference}" is not a merge request reference; use group/project!12`,
				);
			if (!isReviewAction(args.action))
				throw new Error(`"${args.action}" is not a review action`);

			const request: ReviewRequest = {
				project: reference.project,
				iid: reference.iid,
				action: args.action,
				...(args.body === undefined ? {} : { body: args.body }),
				...(args.discussionId === undefined
					? {}
					: { discussionId: args.discussionId }),
			};
			const outcome = await deps.review.submit(request, args.confirm);
			const draft = outcome.draft;
			const summary = outcome.performed
				? `${draft.summary} on ${draft.subject}.${outcome.result === undefined || outcome.result === "" ? "" : ` GitLab answered: ${outcome.result}`}`
				: this.pendingText(draft);

			return {
				performed: outcome.performed,
				summary,
				action: draft.action,
				subject: draft.subject,
				...(draft.body === undefined ? {} : { body: draft.body }),
				...(draft.discussionId === undefined
					? {}
					: { discussionId: draft.discussionId }),
				...(outcome.result === undefined ? {} : { result: outcome.result }),
			};
		},
	});

	/** What the model reads before the user has agreed to anything. */
	private pendingText(draft: {
		summary: string;
		subject: string;
		body?: string;
	}): string {
		const lines = [
			`Not sent yet. ${draft.summary} on ${draft.subject}${draft.body === undefined ? "." : ":"}`,
		];

		if (draft.body !== undefined) lines.push("", draft.body, "");

		lines.push(
			"Show this wording to the user and ask whether to send it. Call gitlab_review again with confirm: true only after they agree.",
		);

		return lines.join("\n");
	}

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): ReviewArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};

		return {
			reference: optionalString(args.mergeRequest) ?? "",
			action: optionalString(args.action) ?? "",
			body: optionalString(args.body),
			discussionId: optionalString(args.discussionId),
			confirm: args.confirm === true,
		};
	}
}

export const reviewTool = new ReviewTool();

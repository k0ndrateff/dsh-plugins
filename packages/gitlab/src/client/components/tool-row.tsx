/**
 * The GitLab tool rows: one line about what a call did.
 *
 * Claiming a tool name in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is GitLab's is what
 * each line says: the scope or reference `gitlab_present` resolved, the counts it
 * found, and, for `gitlab_review`, whether the action was sent or is still
 * waiting for the user.
 *
 * The rows stay deliberately terse. The items belong to the card under the
 * answer, and a tool group that reproduces them buries the answer.
 */

import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
} from "dsh-integration-ui";
import { asGitLabPresentation } from "../../shared/meta";

/** The server's own words, as the last resort for a row with no payload. */
const textOf = (block: ToolRowBlock | undefined): string =>
	(block?.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();

/** The first reference of a preparing call, when it named any. */
const firstReference = (value: unknown): string | undefined => {
	if (!Array.isArray(value)) return undefined;

	return value.find(
		(item): item is string => typeof item === "string" && item !== "",
	);
};

/** What a preparing `gitlab_present` call asked for. */
const askedFor = (block: ToolRowBlock | undefined): string | undefined => {
	const args = blockArgs(block);

	if (typeof args.search === "string" && args.search !== "") return args.search;
	if (typeof args.scope === "string" && args.scope !== "") return args.scope;

	return (
		firstReference(args.mergeRequests) ??
		firstReference(args.findings) ??
		firstReference(args.jobs)
	);
};

/** One short phrase describing what a settled `gitlab_present` call found. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const card = asGitLabPresentation(block?.meta);
	if (card === undefined) return "done";

	let mergeRequests = 0;
	let findings = 0;
	let jobs = 0;

	for (const item of card.items) {
		if (item.kind === "merge_request") mergeRequests += 1;
		else if (item.kind === "finding") findings += 1;
		else jobs += 1;
	}

	const parts: string[] = [];

	if (mergeRequests > 0) parts.push(`${mergeRequests} merge requests`);
	if (findings > 0) parts.push(`${findings} findings`);
	if (jobs > 0) parts.push(`${jobs} failed jobs`);

	return parts.join(" · ");
};

/** One `gitlab_present` call, as a single line. */
export const GitLabPresentRow = createToolRow({
	displayName: () => "Merge requests",
	asked: askedFor,
	summarize,
});

/** What a preparing `gitlab_review` call asked to do. */
const askedReview = (block: ToolRowBlock | undefined): string | undefined => {
	const args = blockArgs(block);
	const action = typeof args.action === "string" ? args.action : undefined;
	const reference =
		typeof args.mergeRequest === "string" ? args.mergeRequest : undefined;

	if (action === undefined) return reference;

	return reference === undefined ? action : `${action} · ${reference}`;
};

/** One short phrase describing what a settled `gitlab_review` call did. */
const summarizeReview = (block: ToolRowBlock | undefined): string => {
	const first = textOf(block).split("\n")[0]?.trim() ?? "";

	return first === "" ? "done" : first;
};

/** One `gitlab_review` call, as a single line. */
export const GitLabReviewRow = createToolRow({
	displayName: () => "Merge request review",
	asked: askedReview,
	summarize: summarizeReview,
});

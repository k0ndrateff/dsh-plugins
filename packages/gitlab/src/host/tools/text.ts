/**
 * The lines the read tools and the card share.
 *
 * A merge request row and a review finding read the same whether the model sees
 * them in a tool's answer or on a card, so both render from here; the cutters
 * are the one place a long answer is shortened, so every tool says so the same
 * way.
 */

import type { FindingCard, MergeRequestCard } from "../../shared/meta";

/**
 * Cut text to a maximum length.
 * @param text - the whole text.
 * @param maxChars - the most of it to keep.
 * @returns the kept text and whether anything was dropped; the caller adds the
 *   notice the model reads.
 */
export const bounded = (
	text: string,
	maxChars: number,
): { readonly text: string; readonly truncated: boolean } =>
	text.length <= maxChars
		? { text, truncated: false }
		: { text: text.slice(0, maxChars), truncated: true };

/**
 * Keep the end of text and drop its start.
 *
 * A failed job prints its failure last, so a trace is shortened from the front:
 * the tail is the part that answers why the pipeline went red.
 */
export const tailBounded = (
	text: string,
	maxChars: number,
): { readonly text: string; readonly truncated: boolean } =>
	text.length <= maxChars
		? { text, truncated: false }
		: { text: text.slice(text.length - maxChars), truncated: true };

/** One merge request as the model's own line. */
export const mrLine = (mr: MergeRequestCard): string => {
	const parts = [
		`${mr.project}!${mr.iid}`,
		mr.title,
		mr.state,
		mr.draft === true ? "draft" : undefined,
		mr.author === undefined ? undefined : `by ${mr.author}`,
		mr.reviewers === undefined || mr.reviewers.length === 0
			? undefined
			: `reviewers: ${mr.reviewers.join(", ")}`,
		mr.pipeline === undefined ? undefined : `pipeline: ${mr.pipeline}`,
		mr.unresolved === undefined ? undefined : `${mr.unresolved} unresolved`,
		mr.url,
	].filter((part): part is string => part !== undefined && part !== "");

	return parts.join(" · ");
};

/** One review finding as the model's own line. */
export const findingLine = (finding: FindingCard): string => {
	const parts = [
		finding.file === undefined
			? finding.discussionId
			: `${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`,
		finding.resolved ? "resolved" : "unresolved",
		finding.author,
		finding.body.split("\n")[0],
	].filter((part): part is string => part !== undefined && part !== "");

	return parts.join(" · ");
};

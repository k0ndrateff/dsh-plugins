/**
 * The Sentry tool row: one line about what the call did.
 *
 * Claiming `sentry_present` in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is Sentry's is what
 * the line says: the query or the first id the call asked for, and what the
 * settled card found.
 *
 * It stays deliberately terse. The issues belong to the card under the answer,
 * and a tool group that reproduces them buries the answer.
 */

import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
} from "dsh-integration-ui";
import { asSentryPresentation } from "../../shared/meta";
import { SENTRY_TOOL_NAME } from "../conversation/card-definition";

/** The first issue id of a preparing call's arguments, when it named any. */
const firstIssue = (value: unknown): string | undefined => {
	if (!Array.isArray(value)) return undefined;

	return value.find((id): id is string => typeof id === "string" && id !== "");
};

/** The query or the first issue id the call asked for, from its arguments. */
const askedFor = (block: ToolRowBlock | undefined): string | undefined => {
	const args = blockArgs(block);
	const query = args.query;

	if (typeof query === "string" && query !== "") return query;

	return firstIssue(args.issues);
};

/** One short phrase describing what a settled call found. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const card = asSentryPresentation(block?.meta);
	if (card === undefined) return "done";

	const count = card.issues.length;
	const parts = [`${count} issue${count === 1 ? "" : "s"}`];

	if (card.query !== undefined) parts.push(card.query);

	return parts.join(" · ");
};

/** One `sentry_present` call, as a single line. */
export const SentryToolRow = createToolRow({
	displayName: () => SENTRY_TOOL_NAME,
	asked: askedFor,
	summarize,
});

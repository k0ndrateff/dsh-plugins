/**
 * The checks tool row: what the call did, in one line.
 *
 * Claiming the name in `tool.call.toolview` replaces the generic row for **every**
 * shape of that call — preparing, running, failed, replayed — and the row's own
 * material belongs to `dsh-integration-ui`. What is devkit's is what the line
 * says: the recipe the call asked for, and how each check it ran came out. It
 * stays terse on purpose: the failures belong to the card under the answer, and a
 * tool group that reproduces them buries the answer.
 */

import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
} from "dsh-integration-ui";
import { asChecksCard, type ChecksCard, checkLabel } from "../../shared/checks";

/** How many checks the row names before it counts the rest. */
const NAMED_CHECKS = 3;

/** The recipe the call asked for, when the row can still see the arguments. */
const askedName = (block: ToolRowBlock | undefined): string | undefined => {
	const name = blockArgs(block).name;

	return typeof name === "string" && name !== "" ? name : undefined;
};

/** One short phrase per check, in config order. */
const summarizeCard = (card: ChecksCard): string => {
	const named = card.checks
		.slice(0, NAMED_CHECKS)
		.map(
			(check) =>
				`${check.name} ${check.status === "passed" ? "✓" : "✗"} ${checkLabel(check)}`,
		);
	const rest = card.checks.length - named.length;

	if (rest > 0) named.push(`… ${rest} more`);

	return named.join(" · ");
};

/** One `checks` call, as a single line. */
export const ChecksToolRow = createToolRow({
	displayName: () => "Project checks",
	asked: askedName,
	summarize: (block) => {
		const card = asChecksCard(block?.meta);

		return card === undefined ? "done" : summarizeCard(card);
	},
	// A cancelled run is not a red row: the person who stopped it knows why,
	// and a failure tint would say the recipe broke.
	state: (block) => {
		const card = asChecksCard(block?.meta);

		if (card === undefined) return "done";

		return card.checks.some(
			(check) => check.status !== "passed" && check.status !== "cancelled",
		)
			? "error"
			: "done";
	},
});

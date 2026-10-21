/**
 * The digest tool row: one line about what the call assembled.
 *
 * Claiming `digest` in `tool.call.toolview` replaces the generic row for **every**
 * shape of that call — preparing, running, failed, replayed — and the row's own
 * material belongs to `dsh-integration-ui`. What is the digest's is what the
 * line says: how many blocks answered and how many of them could not be read.
 */

import { createToolRow, type ToolRowBlock } from "dsh-integration-ui";
import { asDigestReport } from "../../shared/digest";

/** One short phrase describing what a settled call assembled. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const report = asDigestReport(block?.meta);

	if (report === undefined) return "done";

	const rows = report.sections.reduce(
		(total, section) => total + section.items.length,
		0,
	);
	const silent = report.sections.filter(
		(section) => section.unavailable !== undefined,
	).length;
	const parts = [
		`${report.sections.length} block${report.sections.length === 1 ? "" : "s"}`,
		`${rows} row${rows === 1 ? "" : "s"}`,
	];

	if (silent > 0) parts.push(`${silent} unavailable`);

	return parts.join(" · ");
};

/** One `digest` call, as a single line. */
export const DigestToolRow = createToolRow({
	displayName: () => "Daily digest",
	summarize,
});

/**
 * The correlation tool row: one line about what the call walked.
 *
 * Claiming `correlate` in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is the chain's is what
 * the line says: the reference it was asked about, then how many hops answered
 * and how many could not be followed.
 */

import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
} from "dsh-integration-ui";
import { asChainReport } from "../../shared/meta";

/** One short phrase describing what a settled call walked. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const report = asChainReport(block?.meta);

	if (report === undefined) return "done";

	const parts = [
		`${report.hops.length} hop${report.hops.length === 1 ? "" : "s"}`,
	];

	if (report.breaks.length > 0)
		parts.push(`${report.breaks.length} not followed`);

	return parts.join(" · ");
};

/** One `correlate` call, as a single line. */
export const ChainToolRow = createToolRow({
	displayName: () => "Correlation",
	asked: (block) => {
		const args = blockArgs(block);

		return typeof args.ref === "string" ? args.ref : undefined;
	},
	summarize,
});

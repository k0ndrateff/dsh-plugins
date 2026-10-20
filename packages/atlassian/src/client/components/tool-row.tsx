/**
 * The Atlassian tool row: one line about what the call did.
 *
 * Claiming a tool name in the `tool.call.toolview` slot replaces the generic row
 * for **every** shape of that call — preparing, running, failed, replayed — and
 * the row's own material belongs to `dsh-integration-ui`. What is Atlassian's is
 * what the line says: the server's own tool name and what the settled call found.
 *
 * It stays deliberately terse. The server's payload is large JSON, and a tool
 * group that reproduces it buries the answer; the cards belong to
 * `atlassian_present`, which puts them where the user is actually reading.
 */

import { createToolRow, type ToolRowBlock } from "dsh-integration-ui";
import { asAtlassianMeta } from "../../shared/meta";

/** The server's tool name, without this plugin's namespace. */
const serverToolName = (toolName: string | undefined): string =>
	(toolName ?? "").replace(/^mcp__atlassian__/u, "") || "Atlassian";

/** "found 3 issues", or "found 3 of 712 pages" when the server said so. */
const found = (
	count: number,
	noun: string,
	total: number | undefined,
): string => {
	const plural = count === 1 ? "" : "s";

	return total === undefined || total <= count
		? `found ${count} ${noun}${plural}`
		: `found ${count} of ${total} ${noun}${plural}`;
};

/** One short phrase describing what a settled call found. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const meta = asAtlassianMeta(block?.meta);
	if (meta === undefined) return "done";

	const parts: string[] = [];
	const total = meta.total;

	if (meta.issues.length > 0)
		parts.push(found(meta.issues.length, "issue", total));
	else if (meta.pages.length > 0)
		parts.push(found(meta.pages.length, "page", total));

	if (meta.query !== undefined) parts.push(meta.query);
	if (parts.length === 0) parts.push("done");

	return parts.join(" · ");
};

/** One Atlassian tool call, as a single line. */
export const AtlassianToolRow = createToolRow({
	displayName: serverToolName,
	summarize,
});

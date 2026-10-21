/**
 * The Atlassian tool row: one line about what the call did.
 *
 * Claiming a tool name in the `tool.call.toolview` slot replaces the generic row
 * for **every** shape of that call — preparing, running, failed, replayed — and
 * the row's own material belongs to `dsh-integration-ui`. What is Atlassian's is
 * what the line says: the surface the call works on, in the reader's words, and
 * what the settled call found.
 *
 * It stays deliberately terse. The server's payload is large JSON, and a tool
 * group that reproduces it buries the answer; the cards belong to
 * `atlassian_present`, which puts them where the user is actually reading.
 *
 * The server publishes a few gateway tools and hides the rest behind them, and
 * the two generations it speaks name the same idea differently. So the row leads
 * with the names a reader will actually meet, and reads anything else as words
 * rather than showing a camel-case identifier. The wire name itself stays on the
 * row as its tooltip.
 */

import { createToolRow, type ToolRowBlock } from "dsh-integration-ui";
import { asAtlassianMeta } from "../../shared/meta";

/**
 * What the tools a reader meets are about.
 *
 * Not a contract: a name the server no longer offers is harmless, a name that is
 * missing simply falls through to {@link asWords}, and the summary after it says
 * what the call found either way.
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
	atlassianUserInfo: "Atlassian account",
	getJiraCurrentUser: "Atlassian account",
	getJiraUser: "Jira person",
	getAccessibleAtlassianResources: "Atlassian sites",
	discover: "Atlassian tools",
	getContentFormatGuide: "Content format",
	executeRead: "Atlassian read",
	executeWrite: "Atlassian write",
	executeDestructive: "Atlassian change",
	searchJiraIssuesUsingJql: "Jira search",
	getJiraIssue: "Jira issue",
	createJiraIssue: "New Jira issue",
	editJiraIssue: "Jira issue edit",
	transitionJiraIssue: "Jira transition",
	addCommentToJiraIssue: "Jira comment",
	addOrEditJiraIssueComment: "Jira comment",
	lookupJiraAccountId: "Jira people",
	listJiraIssueAssignableUsers: "Jira people",
	searchConfluenceUsingCql: "Confluence search",
	searchConfluence: "Confluence search",
	getConfluencePage: "Confluence page",
	getConfluenceContent: "Confluence content",
	createConfluencePage: "New Confluence page",
	updateConfluencePage: "Confluence page edit",
	createConfluenceComment: "Confluence comment",
	listConfluenceComments: "Confluence comments",
	search: "Atlassian search",
	fetch: "Atlassian resource",
};

/**
 * One wire name read as words: `getJiraIssue` becomes "Get Jira issue".
 * @param name - the server's tool name, without this plugin's namespace.
 * @returns the name with its word boundaries spelled out.
 */
const asWords = (name: string): string => {
	const words = name
		.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
		.replace(/[_-]+/gu, " ")
		.trim();

	if (words === "") return "Atlassian";

	return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
};

/** The surface one tool works on, in the reader's words. */
const toolLabel = (toolName: string | undefined): string => {
	const name = (toolName ?? "").replace(/^mcp__atlassian__/u, "");

	return TOOL_LABELS[name] ?? asWords(name);
};

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
	displayName: toolLabel,
	summarize,
});

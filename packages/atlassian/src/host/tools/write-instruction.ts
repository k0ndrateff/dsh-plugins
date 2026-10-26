/**
 * The one thing a write tool must tell the agent to do.
 *
 * A read tool's answer is the work; a write tool's answer is only a receipt.
 * The user clicked nothing and sees nothing unless the agent says what changed,
 * so the rule travels with the tool definition itself rather than with the
 * server's own prose — the provider cannot know it is talking to a UI.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";

/** The sentence appended to every tool that changes something. */
const REPORT_INSTRUCTION =
	" After the call, tell the user what changed: name the item and the state you set.";

/**
 * Atlassian's tools that change Jira or Confluence rather than read it.
 *
 * Both generations are listed, like {@link TOOL_NAMES}: a name the server no
 * longer offers is harmless, and a missing one only means its description stays
 * the provider's own.
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"executeWrite",
	"executeDestructive",
	"createJiraIssue",
	"editJiraIssue",
	"transitionJiraIssue",
	"addJiraIssueComment",
	"addCommentToJiraIssue",
	"addOrEditJiraIssueComment",
	"createJiraIssueLink",
	"watchJiraIssue",
	"manageJiraSprint",
	"manageJiraProjectVersion",
	"addOrEditJiraIssueWorklog",
	"uploadAttachmentToJiraIssue",
	"createConfluencePage",
	"updateConfluencePage",
	"createConfluenceContent",
	"updateConfluenceContent",
	"createConfluenceComment",
	"updateConfluenceComment",
	"createConfluenceAttachment",
]);

/**
 * Add the report-what-changed instruction to a write tool.
 * @param definition - the tool as the MCP server published it.
 * @param toolName - the server's own name, before the published prefix.
 * @returns the definition, unchanged for a read tool.
 */
export const withWriteInstruction = (
	definition: ToolDefinition,
	toolName: string,
): ToolDefinition =>
	WRITE_TOOLS.has(toolName)
		? {
				...definition,
				description: `${definition.description}${REPORT_INSTRUCTION}`,
			}
		: definition;

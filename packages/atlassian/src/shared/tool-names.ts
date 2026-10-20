/**
 * The Atlassian server tools this plugin knows how to draw.
 *
 * Atlassian publishes a few primary tools in `tools/list` and reaches the rest
 * through `discover` / `executeRead` / `executeWrite`, and the v1 and v2
 * generations use different names for the same idea — both sets are listed.
 * A name the server no longer offers is harmless; a name that is missing simply
 * falls back to the generic tool row, so this list is a presentation detail
 * rather than a contract.
 */
import { publicToolName } from "dsh-mcp-oauth/tool-name";

/** The namespace every published tool of this plugin lives under. */
const TOOL_NAMESPACE = "atlassian";

export const TOOL_NAMES = [
	// Shared and v2 gateway tools.
	"atlassianUserInfo",
	"getAccessibleAtlassianResources",
	"discover",
	"getContentFormatGuide",
	"executeRead",
	"executeWrite",
	"executeDestructive",
	// Jira, both generations.
	"getJiraIssue",
	"searchJiraIssuesUsingJql",
	"createJiraIssue",
	"editJiraIssue",
	"transitionJiraIssue",
	"addOrEditJiraIssueComment",
	"addCommentToJiraIssue",
	"getJiraProjectIssueTypesMetadata",
	"listJiraProjects",
	"listJiraIssueComments",
	"listJiraIssueTransitions",
	"listJiraStatuses",
	"getJiraUser",
	"getJiraCurrentUser",
	"lookupJiraAccountId",
	"listJiraIssueAssignableUsers",
	"listJiraIssueWorklogs",
	"listJiraIssueLinkTypes",
	"listJiraIssueRemoteIssueLinks",
	"listJiraIssueChangelogs",
	"listJiraFilters",
	"listJiraDashboards",
	"listJiraBoards",
	"getJiraBoardConfig",
	"getJiraBoardIssueData",
	"getJiraBoardSprintData",
	"listJiraBoardSprints",
	"listJiraProjectComponents",
	"getJiraProjectVersions",
	"getJiraEntityProperty",
	"addOrEditJiraIssueWorklog",
	"createJiraIssueLink",
	"watchJiraIssue",
	"manageJiraSprint",
	"manageJiraProjectVersion",
	"uploadAttachmentToJiraIssue",
	"downloadJiraIssueAttachment",
	// Confluence, both generations.
	"getConfluencePage",
	"getConfluenceContent",
	"searchConfluenceUsingCql",
	"searchConfluence",
	"createConfluencePage",
	"updateConfluencePage",
	"createConfluenceContent",
	"updateConfluenceContent",
	"getConfluenceSpaces",
	"listConfluenceSpaces",
	"getConfluenceSpace",
	"listConfluenceContent",
	"listConfluenceComments",
	"getConfluenceComment",
	"listConfluenceAttachments",
	"getConfluenceAttachment",
	"listConfluenceContentVersions",
	"getConfluenceContentVersion",
	"exportConfluenceContent",
	"listConfluenceTasks",
	"getConfluenceTask",
	"listConfluenceTemplates",
	"getConfluenceTemplate",
	"getConfluenceContentPermissions",
	"getConfluenceSpaceInstructions",
	"createConfluenceComment",
	"updateConfluenceComment",
	"createConfluenceAttachment",
	// Rovo search, which often answers a Jira or Confluence question.
	"search",
] as const;

/** Every public tool name this plugin knows how to draw. */
export const PUBLIC_TOOL_NAMES: readonly string[] = TOOL_NAMES.map((name) =>
	publicToolName(name, TOOL_NAMESPACE),
);

/**
 * The Atlassian tool names this plugin knows how to draw.
 *
 * Atlassian publishes a few primary tools in `tools/list` and reaches the rest
 * through `discover` / `executeRead` / `executeWrite`, and the v1 and v2
 * generations use different names for the same idea — both sets are listed.
 * A name the server no longer offers is harmless; a name that is missing simply
 * falls back to the generic tool row, so this list is a presentation detail
 * rather than a contract.
 */
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

/** The prefix every published Atlassian tool carries. */
const TOOL_PREFIX = "mcp__atlassian__";

/** The harness caps a tool name at 64 characters. */
const MAX_TOOL_NAME = 64;

/**
 * A deterministic 12-hex-character digest of a string.
 *
 * This only has to disambiguate tool names that are too long to publish as-is,
 * so it is a plain FNV-1a variant rather than a cryptographic hash: it runs
 * identically in Node and in the browser, and the two halves must agree on the
 * published name or the client's cards would attach to the wrong key.
 */
function digestOf(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;

	for (let index = 0; index < input.length; index += 1) {
		hash = ((hash ^ BigInt(input.charCodeAt(index))) * prime) & mask;
	}

	return hash.toString(16).padStart(16, "0").slice(0, 12);
}

/**
 * The public harness tool name for one server tool.
 *
 * Keeps the server's own spelling when it fits — which is the normal case, and
 * what makes the client's keyed cards line up — and appends a digest when it
 * does not, so two distinct server tools can never collapse into one name.
 */
export function publicToolName(serverTool: string): string {
	const cleaned = serverTool.replace(/[^A-Za-z0-9_-]/gu, "_") || "tool";
	const full = `${TOOL_PREFIX}${cleaned}`;

	if (full.length <= MAX_TOOL_NAME) return full;

	const digest = digestOf(serverTool);

	return `${full.slice(0, MAX_TOOL_NAME - digest.length - 1)}_${digest}`;
}

/** Every public tool name this plugin knows how to draw. */
export const PUBLIC_TOOL_NAMES: readonly string[] = TOOL_NAMES.map((name) =>
	publicToolName(name),
);

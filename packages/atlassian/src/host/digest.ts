/**
 * What Atlassian contributes to a digest.
 *
 * The two Jira blocks are the ones a morning digest is for: work already in
 * flight (including anything overdue), and work assigned but not started. Both
 * are asked for in JQL — the site's own vocabulary — and read through the same
 * extractor the `atlassian_present` tool uses, so the digest and the card can
 * never disagree about what a Jira issue looks like.
 *
 * The source is registered through the digest registry rather than imported by
 * it: a deployment without the digest plugin never calls this, and no plugin
 * reaches into another's code.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	DIGEST_SOURCES,
	type DigestItem,
	type DigestLoadOptions,
	type DigestSource,
	type RuntimeState,
} from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import type { IssueCard } from "../shared/meta";
import { extractor } from "./presentation/extract";
import type { SiteFacts } from "./store/site";

/** The Jira tool the two blocks read through. */
const SEARCH_TOOL = "searchJiraIssuesUsingJql";

/** The fields a digest row needs, and nothing a summary pass would want. */
const ISSUE_FIELDS = [
	"summary",
	"status",
	"assignee",
	"priority",
	"issuetype",
	"duedate",
];

/**
 * The query behind each block.
 *
 * `statusCategory != Done` keeps both blocks to open work; the active block adds
 * anything whose due date has passed, because an overdue task is work in flight
 * whatever its status column says.
 */
const JQL: Readonly<Record<string, string>> = {
	"jira-active":
		'assignee = currentUser() AND statusCategory != Done AND (statusCategory = "In Progress" OR duedate <= now()) ORDER BY duedate ASC',
	"jira-queued":
		'assignee = currentUser() AND statusCategory = "To Do" ORDER BY created DESC',
};

/** Everything the source reads through, wired once at apply time. */
export interface DigestDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<SiteFacts>;
}

/** One issue, as a digest row. */
const toItem = (issue: IssueCard): DigestItem => {
	const meta = [issue.status, issue.priority].filter(Boolean).join(" · ");

	return {
		id: issue.key,
		title: [issue.key, issue.summary].filter(Boolean).join(" · "),
		...(issue.url === undefined ? {} : { url: issue.url }),
		...(meta === "" ? {} : { meta }),
	};
};

/** The Atlassian contribution. */
export const atlassianDigestSource = (deps: DigestDeps): DigestSource => ({
	provider: "Atlassian",
	blocks: [
		{
			id: "jira-active",
			title: "Jira · In progress and overdue",
			defaultOn: true,
		},
		{
			id: "jira-queued",
			title: "Jira · Assigned, not started",
			defaultOn: true,
		},
	],
	load: async (
		blockId: string,
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]> => {
		const jql = JQL[blockId];

		if (jql === undefined) throw new Error(`no Jira block named "${blockId}"`);

		const cloudId = deps.state.facts?.cloudId;

		if (cloudId === undefined)
			throw new Error(
				"the Atlassian site is not known yet; run /atlassian sync",
			);

		const value = await deps.bridge.callTool(SEARCH_TOOL, {
			cloudId,
			jql,
			fields: ISSUE_FIELDS,
			maxResults: options.limit,
		});

		return extractor
			.extract({
				tool: SEARCH_TOOL,
				args: {},
				value,
				siteUrl: deps.state.facts?.siteUrl,
			})
			.issues.slice(0, options.limit)
			.map(toItem);
	},
});

/**
 * Offer Atlassian's blocks to the digest plugin, if it is installed.
 *
 * A scoped `inject` is what makes the digest plugin optional: the registration
 * waits for the service and is withdrawn with it, and a deployment that never
 * loads the digest plugin simply leaves this fiber pending.
 * @param ctx - the plugin's host context.
 * @param deps - the MCP bridge and the site facts.
 */
export const registerDigestSource = (ctx: Context, deps: DigestDeps): void => {
	ctx.inject([DIGEST_SOURCES], (scoped) => {
		scoped.effect(
			() => scoped.digestSources.register(atlassianDigestSource(deps)),
			"atlassian: digest source",
		);
	});
};

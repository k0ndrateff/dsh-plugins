/**
 * What Atlassian contributes to a chain.
 *
 * One entry kind, `task`: asked about a key, it answers with the Jira issue the
 * key names — its summary, its status, and whom it is with. It is the end of a
 * chain as written today, because a tracker issue does not itself point at code;
 * if it ever does, its own links become references and this source grows a kind
 * to answer for them.
 *
 * The source registers itself with the correlation registry rather than being
 * imported by it; a deployment without the correlation plugin never calls this.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	CORRELATION_SOURCES,
	type CorrelationFact,
	type CorrelationRef,
	type CorrelationSource,
	type RuntimeState,
} from "dsh-integration-host";
import { asRecord, type McpBridge, mcpJson, pickString } from "dsh-mcp-oauth";
import { extractor } from "./presentation/extract";
import type { SiteFacts } from "./store/site";

/** The tool that reads one issue. */
const ISSUE_TOOL = "getJiraIssue";

/** The fields a chain hop shows, and no more. */
const ISSUE_FIELDS = ["summary", "status", "assignee", "issuetype", "priority"];

/** Everything the source reads through, wired once at apply time. */
export interface CorrelationDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<SiteFacts>;
}

/** The named value of a Jira field, which may arrive as an object or a string. */
const nameOf = (value: unknown): string | undefined =>
	typeof value === "string" && value !== ""
		? value
		: pickString(asRecord(value) ?? {}, "displayName", "name", "value");

/** What one issue answers with. */
const factOf = (
	key: string,
	value: unknown,
	siteUrl?: string,
): CorrelationFact => {
	const record =
		mcpJson(value)
			.map((root) => asRecord(root))
			.find(
				(candidate) =>
					candidate !== undefined &&
					(candidate.fields !== undefined || candidate.key !== undefined),
			) ?? {};
	const fields = asRecord(record.fields) ?? record;
	const identity = pickString(record, "key") ?? key;
	const summary = extractor.text(pickString(fields, "summary"));
	const parts = [
		nameOf(fields.status),
		nameOf(fields.issuetype),
		nameOf(fields.priority),
		nameOf(fields.assignee),
	].filter((part): part is string => part !== undefined && part !== "");

	return {
		id: `jira:${identity}`,
		provider: "Atlassian",
		kind: "task",
		label: "Jira issue",
		title: summary === undefined ? identity : `${identity} · ${summary}`,
		...(siteUrl === undefined ? {} : { url: `${siteUrl}/browse/${identity}` }),
		...(parts.length === 0 ? {} : { meta: parts.join(" · ") }),
	};
};

/** The Atlassian contribution. */
export const atlassianCorrelationSource = (
	deps: CorrelationDeps,
): CorrelationSource => ({
	provider: "Atlassian",
	entry: "task",
	resolves: ["task"],
	resolve: async (ref: CorrelationRef) => {
		if (ref.kind !== "task") return [];

		const cloudId = deps.state.facts?.cloudId;

		if (cloudId === undefined)
			throw new Error(
				"no Atlassian site known yet; sign in again or run /atlassian sync",
			);

		const value = await deps.bridge.callTool(ISSUE_TOOL, {
			cloudId,
			issueIdOrKey: ref.key,
			fields: ISSUE_FIELDS,
			responseContentFormat: "markdown",
		});

		return [factOf(ref.key, value, deps.state.facts?.siteUrl)];
	},
});

/**
 * Offer Atlassian's chain contribution to the correlation plugin, if it is installed.
 * @param ctx - the plugin's host context.
 * @param deps - the MCP bridge and the site facts.
 */
export const registerCorrelationSource = (
	ctx: Context,
	deps: CorrelationDeps,
): void => {
	ctx.inject([CORRELATION_SOURCES], (scoped) => {
		scoped.effect(
			() =>
				scoped.correlationSources.register(atlassianCorrelationSource(deps)),
			"atlassian: correlation source",
		);
	});
};

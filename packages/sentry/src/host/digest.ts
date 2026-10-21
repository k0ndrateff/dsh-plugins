/**
 * What Sentry contributes to a digest.
 *
 * One block: the errors that first appeared in the window a digest covers. The
 * answer is the same Markdown `search_issues` returns to the `sentry_present`
 * tool, read by the same parser, so a digest row and a card row are the same
 * issue described the same way.
 *
 * The source registers itself with the digest registry rather than being
 * imported by it; a deployment without the digest plugin never calls this.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	DIGEST_SOURCES,
	type DigestItem,
	type DigestLoadOptions,
	type DigestSource,
	type RuntimeState,
} from "dsh-integration-host";
import { type McpBridge, mcpText } from "dsh-mcp-oauth";
import type { IssueCard } from "../shared/meta";
import { parseIssueSearch } from "./presentation/parse";
import type { OrganizationFacts } from "./store/organization";

/** The tool the block reads through. */
const SEARCH_TOOL = "search_issues";

/** Everything the source reads through, wired once at apply time. */
export interface DigestDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<OrganizationFacts>;
}

/** One issue, as a digest row. */
const toItem = (issue: IssueCard): DigestItem => {
	const meta = [
		issue.status,
		issue.users === undefined ? undefined : `${issue.users} users`,
		issue.events === undefined ? undefined : `${issue.events} events`,
	]
		.filter(Boolean)
		.join(" · ");

	return {
		id: issue.id,
		title: [issue.id, issue.title].filter(Boolean).join(" · "),
		...(issue.url === undefined ? {} : { url: issue.url }),
		...(meta === "" ? {} : { meta }),
	};
};

/** The Sentry contribution. */
export const sentryDigestSource = (deps: DigestDeps): DigestSource => ({
	provider: "Sentry",
	blocks: [
		{
			id: "sentry-errors",
			title: "Sentry · New errors in the window",
			defaultOn: true,
		},
	],
	load: async (
		_blockId: string,
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]> => {
		const organization = deps.state.facts?.slug;

		if (organization === undefined)
			throw new Error(
				"no Sentry organization known yet; sign in, or run /sentry sync",
			);

		const value = await deps.bridge.callTool(SEARCH_TOOL, {
			organizationSlug: organization,
			query: "is:unresolved",
			period: "24h",
			sort: "new",
			limit: options.limit,
		});

		return parseIssueSearch(mcpText(value).join("\n"))
			.issues.slice(0, options.limit)
			.map(toItem);
	},
});

/**
 * Offer Sentry's block to the digest plugin, if it is installed.
 * @param ctx - the plugin's host context.
 * @param deps - the MCP bridge and the organization facts.
 */
export const registerDigestSource = (ctx: Context, deps: DigestDeps): void => {
	ctx.inject([DIGEST_SOURCES], (scoped) => {
		scoped.effect(
			() => scoped.digestSources.register(sentryDigestSource(deps)),
			"sentry: digest source",
		);
	});
};

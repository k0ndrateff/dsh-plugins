/**
 * What Sentry contributes to a chain.
 *
 * One entry kind, `error`: asked about an issue, it answers with the issue
 * itself and points at what it can see from there — the commit its SCM
 * integration suspects, and any tracker key that commit message names. It
 * resolves neither of them: which code host owns a commit, and which tracker
 * owns a key, are questions for the integrations that answer for those, and
 * Sentry says only what it knows.
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
import { type McpBridge, mcpText } from "dsh-mcp-oauth";
import type { IssueDetail } from "../shared/meta";
import { parseIssueDetail } from "./presentation/parse";
import type { OrganizationFacts } from "./store/organization";

/** The tool that reads one issue. */
const RESOURCE_TOOL = "get_sentry_resource";

/** A web address, which is the only shape of link worth keeping. */
const LINK = /^https?:\/\/\S+$/u;

/** Everything the source reads through, wired once at apply time. */
export interface CorrelationDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<OrganizationFacts>;
}

/** The issue's line, from whichever field says the most. */
const titleOf = (detail: IssueDetail): string =>
	[detail.id, detail.message ?? detail.description ?? detail.culprit]
		.filter((part): part is string => part !== undefined && part !== "")
		.join(" · ");

/** One tag's value, by name, however the answer cased it. */
const tagOf = (detail: IssueDetail, name: string): string | undefined =>
	detail.tags.find((tag) => tag.name.toLowerCase() === name)?.value;

/** The one supporting detail a hop shows: state, volume, and where it ran. */
const metaOf = (detail: IssueDetail): string | undefined => {
	const release = tagOf(detail, "release");
	const environment = tagOf(detail, "environment");
	const parts = [
		detail.status,
		detail.occurrences === undefined
			? undefined
			: `${String(detail.occurrences)} events`,
		release === undefined ? undefined : `release ${release}`,
		environment,
	].filter((part): part is string => part !== undefined && part !== "");

	return parts.length === 0 ? undefined : parts.join(" · ");
};

/**
 * The commit the issue points at.
 *
 * The suspect commit's own source is often not a link ("via SCM integration"),
 * so the code location's link travels with the reference: it is somewhere in the
 * same repository, which is all a code host needs to recognize its own project
 * without either side agreeing on a naming scheme.
 */
const commitRef = (detail: IssueDetail): CorrelationRef | undefined => {
	const suspect = detail.suspect;

	if (suspect === undefined) return undefined;

	const source = suspect.source;
	const location = detail.code?.url;
	const url =
		source !== undefined && LINK.test(source)
			? source
			: location !== undefined && LINK.test(location)
				? location
				: undefined;

	return {
		kind: "commit",
		sha: suspect.sha,
		label: `Suspect commit ${suspect.sha.slice(0, 7)}`,
		...(url === undefined ? {} : { url }),
		...(detail.code?.repository === undefined
			? {}
			: { repository: detail.code.repository }),
	};
};

/** What one issue answers with. */
const factOf = (detail: IssueDetail): CorrelationFact => {
	const references = [
		commitRef(detail),
		detail.suspect?.issueKey === undefined
			? undefined
			: { kind: "task" as const, key: detail.suspect.issueKey },
	].filter((ref): ref is CorrelationRef => ref !== undefined);
	const meta = metaOf(detail);

	return {
		id: `sentry:${detail.id}`,
		provider: "Sentry",
		kind: "error",
		label: "Error",
		title: titleOf(detail),
		...(detail.url === undefined ? {} : { url: detail.url }),
		...(meta === undefined ? {} : { meta }),
		...(references.length === 0 ? {} : { references }),
	};
};

/** The Sentry contribution. */
export const sentryCorrelationSource = (
	deps: CorrelationDeps,
): CorrelationSource => ({
	provider: "Sentry",
	entry: "error",
	resolves: ["error"],
	resolve: async (ref: CorrelationRef) => {
		if (ref.kind !== "error") return [];

		const organization = deps.state.facts?.slug;

		if (organization === undefined)
			throw new Error(
				"no Sentry organization known yet; sign in, or run /sentry sync",
			);

		const value = await deps.bridge.callTool(RESOURCE_TOOL, {
			organizationSlug: organization,
			resourceType: "issue",
			resourceId: ref.id,
		});
		const detail = parseIssueDetail(mcpText(value).join("\n"));

		if (detail.id === "")
			throw new Error(`Sentry returned no issue for "${ref.id}"`);

		return [factOf(detail)];
	},
});

/**
 * Offer Sentry's chain contribution to the correlation plugin, if it is installed.
 * @param ctx - the plugin's host context.
 * @param deps - the MCP bridge and the organization facts.
 */
export const registerCorrelationSource = (
	ctx: Context,
	deps: CorrelationDeps,
): void => {
	ctx.inject([CORRELATION_SOURCES], (scoped) => {
		scoped.effect(
			() => scoped.correlationSources.register(sentryCorrelationSource(deps)),
			"sentry: correlation source",
		);
	});
};

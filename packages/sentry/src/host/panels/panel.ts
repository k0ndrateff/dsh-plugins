/**
 * The side panel's view of one Sentry issue.
 *
 * The panel is the only place that writes: it resolves, ignores, reopens, and
 * assigns. Every write reloads the issue afterwards, so the panel shows what
 * Sentry actually stored rather than what was asked for.
 *
 * Both reads and writes go through the MCP bridge, which is the same channel
 * the agent's own tools use — the panel has no second path to Sentry.
 *
 * A card from organization B opens organization B's panel: the navigation
 * target may name its own organization, and only a target without one falls
 * back to the selected default.
 */

import type { RuntimeState } from "dsh-integration-host";
import {
	asRecord,
	type GrantStore,
	type McpBridge,
	mcpJson,
	mcpText,
	pickString,
} from "dsh-mcp-oauth";
import type { IssueDetail, IssuePanel } from "../../shared/meta";
import { parseIssueDetail } from "../presentation/parse";
import {
	type OrganizationFacts,
	organizationFacts,
} from "../store/organization";

/** The tool that reads one issue. */
const RESOURCE_TOOL = "get_sentry_resource";

/** The tool that moves an issue's status or its owner. */
const UPDATE_TOOL = "update_issue";

/** The tool that names the caller. */
const WHOAMI_TOOL = "whoami";

/** What the panel needs from the plugin. */
export interface PanelDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<OrganizationFacts>;
	/** Where a selected default organization is remembered, when the host passes it. */
	readonly store?: Pick<GrantStore, "remember">;
}

export class PanelApi {
	constructor(private readonly deps: PanelDeps) {}

	/**
	 * Load one issue with everything the panel draws.
	 * @param id - Sentry's short id, such as `CHECKOUT-13P`.
	 * @param organization - the organization a card named, when it named one.
	 */
	async issue(id: string, organization?: string): Promise<IssuePanel> {
		const slug = this.organizationOf(organization);
		const url = this.deps.state.facts?.urlOf(slug);

		return {
			issue: await this.read(id, slug),
			organization: slug,
			...(url === undefined ? {} : { organizationUrl: url }),
		};
	}

	/**
	 * Move one issue through Sentry's own status vocabulary.
	 * @param id - the issue's short id.
	 * @param status - `resolved`, `unresolved`, or `ignored`.
	 * @param ignoreMode - how an ignored issue behaves, when the caller chose.
	 * @param organization - the organization a card named, when it named one.
	 */
	async setStatus(
		id: string,
		status: string,
		ignoreMode?: string,
		organization?: string,
	): Promise<IssuePanel> {
		await this.deps.bridge.callTool(UPDATE_TOOL, {
			organizationSlug: this.organizationOf(organization),
			issueId: id,
			status,
			...(ignoreMode === undefined ? {} : { ignoreMode }),
		});

		return await this.issue(id, organization);
	}

	/**
	 * Hand one issue to a user or a team.
	 * @param id - the issue's short id.
	 * @param assignedTo - `user:<id>` or `team:<id|slug>`, or null to unassign.
	 * @param organization - the organization a card named, when it named one.
	 */
	async assign(
		id: string,
		assignedTo: string | null,
		organization?: string,
	): Promise<IssuePanel> {
		await this.deps.bridge.callTool(UPDATE_TOOL, {
			organizationSlug: this.organizationOf(organization),
			issueId: id,
			assignedTo,
		});

		return await this.issue(id, organization);
	}

	/**
	 * The reference that assigns an issue to the person reading the panel.
	 *
	 * Sentry offers no member directory, so `whoami` is the only assignment this
	 * panel can name without the user typing one. It answers as JSON on some
	 * deployments and as a sentence on others, and a deployment that names no id
	 * answers null — the panel then leaves "assign to me" out rather than offering
	 * a reference Sentry would refuse.
	 * @returns `user:<id>`, or null when the answer names no id.
	 */
	async me(): Promise<string | null> {
		const value = await this.deps.bridge.callTool(WHOAMI_TOOL, {});
		const id = this.userIdOf(value);

		return id === undefined ? null : `user:${id}`;
	}

	/**
	 * Make one of the account's organizations the default.
	 *
	 * The choice is remembered beside the tokens, so switching organizations
	 * needs no sign-out — which is what a multi-organization account otherwise
	 * has to do.
	 * @param slug - an organization from the account's own list.
	 * @returns the facts as the rest of the plugin now sees them.
	 * @throws when no organizations are known yet, or the slug names none.
	 */
	async selectOrganization(slug: string): Promise<OrganizationFacts> {
		const current = this.deps.state.facts;

		if (current === undefined)
			throw new Error(
				"no Sentry organizations known yet; sign in, or run /sentry sync",
			);

		const next = current.withSelection(slug);

		if (next === undefined)
			throw new Error(`unknown Sentry organization: ${slug}`);

		this.deps.state.facts = next;
		await this.deps.store?.remember(organizationFacts.remember(next));

		return next;
	}

	/** The caller's numeric id, from whichever shape the answer arrived in. */
	private userIdOf(value: unknown): string | undefined {
		for (const root of mcpJson(value)) {
			const record = asRecord(root);
			const id =
				pickString(asRecord(record?.user), "id") ?? pickString(record, "id");

			if (id !== undefined) return id;
		}

		return /"id"\s*:\s*"?(\d+)"?/.exec(mcpText(value).join("\n"))?.[1];
	}

	/** Read one issue document from one organization. */
	private async read(id: string, organization: string): Promise<IssueDetail> {
		const value = await this.deps.bridge.callTool(RESOURCE_TOOL, {
			organizationSlug: organization,
			resourceType: "issue",
			resourceId: id,
		});

		const detail = parseIssueDetail(mcpText(value).join("\n"));

		if (detail.id === "")
			throw new Error(`Sentry returned no issue for "${id}"`);

		return detail;
	}

	/** The organization a read or write must name. */
	private organizationOf(explicit: string | undefined): string {
		const organization = explicit ?? this.deps.state.facts?.slug;

		if (organization === undefined)
			throw new Error(
				"no Sentry organization known yet; sign in, or run /sentry sync",
			);

		return organization;
	}
}

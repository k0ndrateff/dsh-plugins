/**
 * The side panel's view of one Sentry issue.
 *
 * The panel is the only place that writes: it resolves, ignores, reopens, and
 * assigns. Every write reloads the issue afterwards, so the panel shows what
 * Sentry actually stored rather than what was asked for.
 *
 * Both reads and writes go through the MCP bridge, which is the same channel
 * the agent's own tools use — the panel has no second path to Sentry.
 */

import { type McpBridge, mcpText } from "dsh-mcp-oauth";
import type { IssueDetail, IssuePanel } from "../../shared/meta";
import { parseIssueDetail } from "../presentation/parse";
import type { RuntimeState } from "../state";

/** The tool that reads one issue. */
const RESOURCE_TOOL = "get_sentry_resource";

/** The tool that moves an issue's status or its owner. */
const UPDATE_TOOL = "update_issue";

/** What the panel needs from the plugin. */
export interface PanelDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState;
}

export class PanelApi {
	constructor(private readonly deps: PanelDeps) {}

	/**
	 * Load one issue with everything the panel draws.
	 * @param id - Sentry's short id, such as `CHECKOUT-13P`.
	 */
	async issue(id: string): Promise<IssuePanel> {
		return { issue: await this.read(id), organization: this.organization() };
	}

	/**
	 * Move one issue through Sentry's own status vocabulary.
	 * @param id - the issue's short id.
	 * @param status - `resolved`, `unresolved`, or `ignored`.
	 * @param ignoreMode - how an ignored issue behaves, when the caller chose.
	 */
	async setStatus(
		id: string,
		status: string,
		ignoreMode?: string,
	): Promise<IssuePanel> {
		await this.deps.bridge.callTool(UPDATE_TOOL, {
			organizationSlug: this.requireOrganization(),
			issueId: id,
			status,
			...(ignoreMode === undefined ? {} : { ignoreMode }),
		});

		return await this.issue(id);
	}

	/**
	 * Hand one issue to a user or a team.
	 * @param id - the issue's short id.
	 * @param assignedTo - `user:<id>` or `team:<id|slug>`, or null to unassign.
	 */
	async assign(id: string, assignedTo: string | null): Promise<IssuePanel> {
		await this.deps.bridge.callTool(UPDATE_TOOL, {
			organizationSlug: this.requireOrganization(),
			issueId: id,
			assignedTo,
		});

		return await this.issue(id);
	}

	/** Read one issue document and read its fields out. */
	private async read(id: string): Promise<IssueDetail> {
		const value = await this.deps.bridge.callTool(RESOURCE_TOOL, {
			organizationSlug: this.requireOrganization(),
			resourceType: "issue",
			resourceId: id,
		});

		const detail = parseIssueDetail(mcpText(value).join("\n"));

		if (detail.id === "")
			throw new Error(`Sentry returned no issue for "${id}"`);

		return detail;
	}

	/** The organization slug, when the plugin has learned one. */
	private organization(): string | null {
		return this.deps.state.organization ?? null;
	}

	/** The organization slug a tool call must name. */
	private requireOrganization(): string {
		const organization = this.organization();

		if (organization === null)
			throw new Error(
				"no Sentry organization known yet; sign in again or run /sentry sync",
			);

		return organization;
	}
}

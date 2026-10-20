/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-atlassian` with ordinary
 * same-origin requests. The transport — JSON in both directions, `{ error }`
 * turned back into a message — belongs to `dsh-integration-ui`; this is the list
 * of calls Atlassian actually makes.
 */

import { createHostRequest } from "dsh-integration-ui";
import type {
	IssuePanel,
	PanelData,
	PanelPerson,
	PanelTarget,
} from "../shared/panel";
import type { AtlassianStatus } from "../shared/status";

const request = createHostRequest("/dsh-atlassian");

export const hostApi = {
	/** Read the current sign-in and connection state. */
	status: async (): Promise<AtlassianStatus> => {
		return await request("/status", "GET");
	},

	/** Start a sign-in attempt; resolves as soon as the attempt is running. */
	login: async (): Promise<AtlassianStatus> => {
		return await request("/login", "POST");
	},

	/** Forget the stored sign-in and withdraw the published tools. */
	logout: async (): Promise<AtlassianStatus> => {
		return await request("/logout", "POST");
	},

	/** Reconnect and re-publish the Atlassian tools. */
	sync: async (): Promise<AtlassianStatus> => {
		return await request("/sync", "POST");
	},

	/** Everything one panel shows for its target. */
	getPanel: async (
		target: PanelTarget,
		signal?: AbortSignal,
	): Promise<PanelData> => {
		return target.kind === "issue"
			? await request(
					`/issue?key=${encodeURIComponent(target.key)}`,
					"GET",
					undefined,
					signal,
				)
			: await request(
					`/page?id=${encodeURIComponent(target.id)}`,
					"GET",
					undefined,
					signal,
				);
	},

	/** People the site matches to a search string. */
	findPeople: async (
		query: string,
		signal?: AbortSignal,
	): Promise<PanelPerson[]> => {
		const found: PanelPerson[] = await request(
			`/people?q=${encodeURIComponent(query)}`,
			"GET",
			undefined,
			signal,
		);

		return Array.isArray(found) ? found : [];
	},

	/** Move one issue through a workflow transition; answers with the fresh issue. */
	transitionIssue: async (
		key: string,
		transitionId: string,
	): Promise<IssuePanel> => {
		return await request("/issue/transition", "POST", {
			key,
			transitionId,
		});
	},

	/** Set or clear one issue's assignee; answers with the fresh issue. */
	assignIssue: async (
		key: string,
		accountId: string | null,
	): Promise<IssuePanel> => {
		return await request("/issue/assignee", "POST", { key, accountId });
	},
};

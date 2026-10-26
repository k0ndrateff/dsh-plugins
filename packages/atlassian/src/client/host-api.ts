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

	/** Abandon the sign-in attempt that is waiting for the browser. */
	cancel: async (): Promise<AtlassianStatus> => {
		return await request("/cancel", "POST");
	},

	/** Reconnect and re-publish the Atlassian tools. */
	sync: async (): Promise<AtlassianStatus> => {
		return await request("/sync", "POST");
	},

	/** Everything one panel shows for its target, on the site the target names. */
	getPanel: async (
		target: PanelTarget,
		signal?: AbortSignal,
	): Promise<PanelData> => {
		const site =
			target.cloudId === undefined
				? ""
				: `&cloudId=${encodeURIComponent(target.cloudId)}`;

		return target.kind === "issue"
			? await request(
					`/issue?key=${encodeURIComponent(target.key)}${site}`,
					"GET",
					undefined,
					signal,
				)
			: await request(
					`/page?id=${encodeURIComponent(target.id)}${site}`,
					"GET",
					undefined,
					signal,
				);
	},

	/**
	 * Make one of the account's sites the default, without signing out.
	 * @param cloudId - a site from the account's own list.
	 */
	selectSite: async (
		cloudId: string,
	): Promise<{ cloudId: string | null; siteUrl: string | null }> => {
		return await request("/site", "POST", { cloudId });
	},

	/**
	 * The signed-in user, as the site names them.
	 * @returns the reader, or null when the site names no account for this token.
	 */
	me: async (): Promise<PanelPerson | null> => {
		const answer = await request<{ person: PanelPerson | null }>("/me", "GET");

		return answer.person;
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

	/**
	 * Move one issue through a workflow transition; answers with the fresh issue.
	 * @param cloudId - the site the panel is showing, when the card named one.
	 */
	transitionIssue: async (
		key: string,
		transitionId: string,
		cloudId?: string,
	): Promise<IssuePanel> => {
		return await request("/issue/transition", "POST", {
			key,
			transitionId,
			...(cloudId === undefined ? {} : { cloudId }),
		});
	},

	/**
	 * Set or clear one issue's assignee; answers with the fresh issue.
	 * @param cloudId - the site the panel is showing, when the card named one.
	 */
	assignIssue: async (
		key: string,
		accountId: string | null,
		cloudId?: string,
	): Promise<IssuePanel> => {
		return await request("/issue/assignee", "POST", {
			key,
			accountId,
			...(cloudId === undefined ? {} : { cloudId }),
		});
	},
};

/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-sentry` with ordinary same-origin
 * requests. The transport — JSON in both directions, `{ error }` turned back
 * into a message — belongs to `dsh-integration-ui`; this is the list of calls
 * Sentry actually makes.
 */

import { createHostRequest } from "dsh-integration-ui";
import type { IssuePanel } from "../shared/meta";
import type { SentryStatus } from "../shared/status";

const request = createHostRequest("/dsh-sentry");

export const hostApi = {
	/** Read the current sign-in and connection state. */
	status: async (): Promise<SentryStatus> => {
		return await request("/status", "GET");
	},

	/** Start a sign-in attempt; resolves as soon as the attempt is running. */
	login: async (): Promise<SentryStatus> => {
		return await request("/login", "POST");
	},

	/** Forget the stored sign-in and withdraw the published tools. */
	logout: async (): Promise<SentryStatus> => {
		return await request("/logout", "POST");
	},

	/** Abandon the sign-in attempt that is waiting for the browser. */
	cancel: async (): Promise<SentryStatus> => {
		return await request("/cancel", "POST");
	},

	/** Reconnect and re-publish the Sentry tools. */
	sync: async (): Promise<SentryStatus> => {
		return await request("/sync", "POST");
	},

	/**
	 * Everything the panel shows for one issue, on the organization it names.
	 * @param organization - the organization the card was read from, when it named one.
	 */
	issue: async (
		id: string,
		organization?: string,
		signal?: AbortSignal,
	): Promise<IssuePanel> => {
		const scope =
			organization === undefined
				? ""
				: `&organization=${encodeURIComponent(organization)}`;

		return await request(
			`/issue?id=${encodeURIComponent(id)}${scope}`,
			"GET",
			undefined,
			signal,
		);
	},

	/**
	 * Make one of the account's organizations the default, without signing out.
	 * @param organization - an organization from the account's own list.
	 */
	selectOrganization: async (
		organization: string,
	): Promise<{
		organization: string | null;
		organizationUrl: string | null;
	}> => {
		return await request("/organization", "POST", { organization });
	},

	/**
	 * The reference that assigns an issue to the signed-in user.
	 * @returns `user:<id>`, or null when Sentry names no id for this account.
	 */
	me: async (): Promise<string | null> => {
		const answer = await request<{ reference: string | null }>("/me", "GET");

		return answer.reference;
	},

	/**
	 * Move one issue through Sentry's status vocabulary; answers with the fresh
	 * issue.
	 * @param ignoreMode - how an ignored issue behaves, when the caller chose.
	 */
	setStatus: async (
		id: string,
		status: string,
		ignoreMode?: string,
		organization?: string,
	): Promise<IssuePanel> => {
		return await request("/issue/status", "POST", {
			id,
			status,
			...(ignoreMode === undefined ? {} : { ignoreMode }),
			...(organization === undefined ? {} : { organization }),
		});
	},

	/** Set or clear one issue's owner; answers with the fresh issue. */
	assign: async (
		id: string,
		assignedTo: string | null,
		organization?: string,
	): Promise<IssuePanel> => {
		return await request("/issue/assign", "POST", {
			id,
			assignedTo,
			...(organization === undefined ? {} : { organization }),
		});
	},
};

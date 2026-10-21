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

	/** Reconnect and re-publish the Sentry tools. */
	sync: async (): Promise<SentryStatus> => {
		return await request("/sync", "POST");
	},

	/** Everything the panel shows for one issue. */
	issue: async (id: string, signal?: AbortSignal): Promise<IssuePanel> => {
		return await request(
			`/issue?id=${encodeURIComponent(id)}`,
			"GET",
			undefined,
			signal,
		);
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
	): Promise<IssuePanel> => {
		return await request("/issue/status", "POST", {
			id,
			status,
			...(ignoreMode === undefined ? {} : { ignoreMode }),
		});
	},

	/** Set or clear one issue's owner; answers with the fresh issue. */
	assign: async (
		id: string,
		assignedTo: string | null,
	): Promise<IssuePanel> => {
		return await request("/issue/assign", "POST", { id, assignedTo });
	},
};

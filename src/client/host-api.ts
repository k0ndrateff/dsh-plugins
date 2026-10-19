/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card reaches the host
 * through the named route `/dsh-atlassian` with ordinary same-origin requests.
 * Every call answers with the same status document, which keeps the card's
 * state transitions trivial: whatever the host last said is what it renders.
 */

import type { AtlassianStatus } from "../shared/status";

type Method = "GET" | "POST";

class HostApi {
	private readonly BASE_PATH = "/dsh-atlassian";

	/** Read the current sign-in and connection state. */
	getStatus = async (): Promise<AtlassianStatus> => {
		return this.request("/status", "GET");
	};

	/** Start a sign-in attempt; resolves as soon as the attempt is running. */
	startSignIn = async (): Promise<AtlassianStatus> => {
		return await this.request("/login", "POST");
	};

	/** Forget the stored sign-in and withdraw the published tools. */
	signOut = async (): Promise<AtlassianStatus> => {
		return await this.request("/logout", "POST");
	};

	/** Reconnect and re-publish the Atlassian tools. */
	syncTools = async (): Promise<AtlassianStatus> => {
		return await this.request("/sync", "POST");
	};

	private request = async (
		path: string,
		method: Method,
	): Promise<AtlassianStatus> => {
		const response = await fetch(`${this.BASE_PATH}${path}`, {
			method,
			headers: { accept: "application/json" },
		});

		if (!response.ok)
			throw new Error(
				`host answered ${response.status} ${response.statusText}`,
			);

		return (await response.json()) as AtlassianStatus;
	};
}

export const hostApi = new HostApi();

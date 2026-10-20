/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-atlassian` with ordinary
 * same-origin requests. Every call answers with JSON; a failed call answers
 * with `{ error }`, which this turns back into the message the user sees.
 */

import type {
	IssuePanel,
	PanelData,
	PanelPerson,
	PanelTarget,
} from "../shared/panel";
import type { AtlassianStatus } from "../shared/status";

type Method = "GET" | "POST";

class HostApi {
	private readonly BASE_PATH = "/dsh-atlassian";

	/** Read the current sign-in and connection state. */
	getStatus = async (): Promise<AtlassianStatus> => {
		return await this.request("/status", "GET");
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

	/** Everything one panel shows for its target. */
	getPanel = async (
		target: PanelTarget,
		signal?: AbortSignal,
	): Promise<PanelData> => {
		return target.kind === "issue"
			? await this.request(
					`/issue?key=${encodeURIComponent(target.key)}`,
					"GET",
					undefined,
					signal,
				)
			: await this.request(
					`/page?id=${encodeURIComponent(target.id)}`,
					"GET",
					undefined,
					signal,
				);
	};

	/** People the site matches to a search string. */
	findPeople = async (
		query: string,
		signal?: AbortSignal,
	): Promise<PanelPerson[]> => {
		const found: PanelPerson[] = await this.request(
			`/people?q=${encodeURIComponent(query)}`,
			"GET",
			undefined,
			signal,
		);

		return Array.isArray(found) ? found : [];
	};

	/** Move one issue through a workflow transition; answers with the fresh issue. */
	transitionIssue = async (
		key: string,
		transitionId: string,
	): Promise<IssuePanel> => {
		return await this.request("/issue/transition", "POST", {
			key,
			transitionId,
		});
	};

	/** Set or clear one issue's assignee; answers with the fresh issue. */
	assignIssue = async (
		key: string,
		accountId: string | null,
	): Promise<IssuePanel> => {
		return await this.request("/issue/assignee", "POST", { key, accountId });
	};

	private request = async <T>(
		path: string,
		method: Method,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<T> => {
		const response = await fetch(`${this.BASE_PATH}${path}`, {
			method,
			headers:
				body === undefined
					? { accept: "application/json" }
					: { accept: "application/json", "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			...(signal === undefined ? {} : { signal }),
		});

		if (!response.ok) throw new Error(await this.failureOf(response));

		return (await response.json()) as T;
	};

	/** The host's own words about why a call failed. */
	private failureOf = async (response: Response): Promise<string> => {
		try {
			const body: unknown = await response.json();

			if (
				body !== null &&
				typeof body === "object" &&
				typeof (body as { error?: unknown }).error === "string"
			)
				return (body as { error: string }).error;
		} catch {
			// Not JSON: the status line is all this can say.
		}

		return `host answered ${response.status} ${response.statusText}`;
	};
}

export const hostApi = new HostApi();

/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-sentry` with ordinary same-origin
 * requests. Every call answers with JSON; a failed call answers with `{ error }`,
 * which this turns back into the message the user sees.
 */

import type { IssuePanel } from "../shared/meta";
import type { SentryStatus } from "../shared/status";

type Method = "GET" | "POST";

class HostApi {
	private readonly BASE_PATH = "/dsh-sentry";

	/** Read the current sign-in and connection state. */
	status = async (): Promise<SentryStatus> => {
		return await this.request("/status", "GET");
	};

	/** Start a sign-in attempt; resolves as soon as the attempt is running. */
	login = async (): Promise<SentryStatus> => {
		return await this.request("/login", "POST");
	};

	/** Forget the stored sign-in and withdraw the published tools. */
	logout = async (): Promise<SentryStatus> => {
		return await this.request("/logout", "POST");
	};

	/** Reconnect and re-publish the Sentry tools. */
	sync = async (): Promise<SentryStatus> => {
		return await this.request("/sync", "POST");
	};

	/** Everything the panel shows for one issue. */
	issue = async (id: string, signal?: AbortSignal): Promise<IssuePanel> => {
		return await this.request(
			`/issue?id=${encodeURIComponent(id)}`,
			"GET",
			undefined,
			signal,
		);
	};

	/**
	 * Move one issue through Sentry's status vocabulary; answers with the fresh
	 * issue.
	 * @param ignoreMode - how an ignored issue behaves, when the caller chose.
	 */
	setStatus = async (
		id: string,
		status: string,
		ignoreMode?: string,
	): Promise<IssuePanel> => {
		return await this.request("/issue/status", "POST", {
			id,
			status,
			...(ignoreMode === undefined ? {} : { ignoreMode }),
		});
	};

	/** Set or clear one issue's owner; answers with the fresh issue. */
	assign = async (
		id: string,
		assignedTo: string | null,
	): Promise<IssuePanel> => {
		return await this.request("/issue/assign", "POST", { id, assignedTo });
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

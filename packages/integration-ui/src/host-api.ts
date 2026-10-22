/**
 * The browser half's channel to a plugin's host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the plugin's own named route with ordinary same-origin
 * requests. Every call answers with JSON; a failed call answers with `{ error }`,
 * which this turns back into the message the user sees.
 */

import {
	CLIENT_REQUEST_HEADER,
	CLIENT_REQUEST_VALUE,
} from "dsh-integration-host/status";

type Method = "GET" | "POST";

/** One request into a plugin's host route. */
export type HostRequest = <T>(
	path: string,
	method: Method,
	body?: unknown,
	signal?: AbortSignal,
) => Promise<T>;

/**
 * Build the request function one integration's host API is written on.
 * @param basePath - the route prefix the plugin registered, such as `/dsh-sentry`.
 */
export const createHostRequest = (basePath: string): HostRequest => {
	/** The host's own words about why a call failed. */
	const failureOf = async (response: Response): Promise<string> => {
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

	return async <T>(
		path: string,
		method: Method,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<T> => {
		const response = await fetch(`${basePath}${path}`, {
			method,
			headers: {
				accept: "application/json",
				[CLIENT_REQUEST_HEADER]: CLIENT_REQUEST_VALUE,
				...(method === "POST" ? { "content-type": "application/json" } : {}),
			},
			...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
			...(signal === undefined ? {} : { signal }),
		});

		if (!response.ok) throw new Error(await failureOf(response));

		return (await response.json()) as T;
	};
};

/**
 * Thin HTTP helpers for the OAuth endpoints.
 *
 * Every call carries a deadline. OAuth discovery, registration, and token
 * exchange happen while the user waits, and an endpoint that accepts a
 * connection and then stalls must not wedge sign-in forever.
 */

import { REQUEST_TIMEOUT_MS } from "./config";
import { errorText } from "./log";

class Network {
	/** A JSON GET, or undefined when the document is absent or unreadable. */
	getJSON = async (
		url: string,
	): Promise<Record<string, unknown> | undefined> => {
		try {
			const response = await fetch(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});

			if (!response.ok) return undefined;

			const body: unknown = await response.json();

			return body !== null && typeof body === "object"
				? (body as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	};

	/** A JSON POST that must succeed; the response body is returned as JSON. */
	postJSON = async (
		url: string,
		body: unknown,
		what: string,
	): Promise<Record<string, unknown>> => {
		let response: Response;

		try {
			response = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new Error(`${what} failed: ${errorText(error)}`);
		}

		const text = await response.text();

		if (!response.ok)
			throw new Error(`${what} failed (${response.status}): ${text}`);

		const parsed: unknown = JSON.parse(text);

		if (parsed === null || typeof parsed !== "object")
			throw new Error(`${what} returned a non-object`);

		return parsed as Record<string, unknown>;
	};

	/** A form POST to a token endpoint, with the same deadline discipline. */
	postForm = async (
		url: string,
		fields: Record<string, string>,
		what: string,
		authorization?: string,
	): Promise<Record<string, unknown>> => {
		let response: Response;

		try {
			response = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					accept: "application/json",
					...(authorization === undefined ? {} : { authorization }),
				},
				body: new URLSearchParams(fields),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new Error(`${what} failed: ${errorText(error)}`);
		}

		const text = await response.text();

		if (!response.ok)
			throw new Error(`${what} failed (${response.status}): ${text}`);

		const parsed: unknown = JSON.parse(text);

		if (parsed === null || typeof parsed !== "object")
			throw new Error(`${what} returned a non-object`);

		return parsed as Record<string, unknown>;
	};
}

export const network = new Network();

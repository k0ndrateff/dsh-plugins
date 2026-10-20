/**
 * The channel to GitLab's REST API.
 *
 * One class, one responsibility: turn a path and a token into a JSON document,
 * and turn GitLab's refusal into a sentence the user can act on. Every read and
 * write this plugin performs goes through here — the agent's tools and the side
 * panel alike — so there is no second path to GitLab and no second error
 * vocabulary.
 *
 * The token is read per call rather than held: the settings card can replace it
 * while the process runs, and the next call then uses the new one.
 */

import type { JsonValue } from "dsh-mcp-oauth";
import { apiRootOf, type GitLabConfig } from "./config";
import type { TokenStore } from "./token";

/** How long one GitLab call may take. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A query parameter's value, or undefined to leave it out. */
export type Param = string | number | boolean | undefined;

/** One document GitLab answered with, and the count it reported beside it. */
export interface Answer<T> {
	readonly value: T;
	/** The `x-total` header, when the endpoint reports one. */
	readonly total?: number;
}

/** Everything the client needs, wired once at apply time. */
export interface ApiDeps {
	readonly config: GitLabConfig;
	readonly token: TokenStore;
}

export class GitLabApi {
	constructor(private readonly deps: ApiDeps) {}

	/**
	 * Read one document.
	 * @param path - the API path, such as `/user`.
	 * @param params - query parameters; undefined values are left out.
	 */
	async get<T = JsonValue>(
		path: string,
		params?: Readonly<Record<string, Param>>,
	): Promise<T> {
		return (await this.getAnswer<T>(path, params)).value;
	}

	/**
	 * Read one document and the count GitLab reports beside it.
	 *
	 * A list endpoint answers with a page and puts the number of matches in
	 * `x-total`; a card that says "25 of 137" needs both.
	 */
	async getAnswer<T = JsonValue>(
		path: string,
		params?: Readonly<Record<string, Param>>,
	): Promise<Answer<T>> {
		const response = await this.request("GET", path, params);
		const total = Number(response.headers.get("x-total"));

		return {
			value: (await response.json()) as T,
			...(Number.isFinite(total) ? { total } : {}),
		};
	}

	/**
	 * Write one document.
	 * @param path - the API path.
	 * @param body - the JSON body, when the endpoint takes one.
	 */
	async post<T = JsonValue>(path: string, body?: unknown): Promise<T> {
		const response = await this.request("POST", path, undefined, body);

		return (await response.json()) as T;
	}

	/** Replace part of one document. */
	async put<T = JsonValue>(path: string, body?: unknown): Promise<T> {
		const response = await this.request("PUT", path, undefined, body);

		return (await response.json()) as T;
	}

	/**
	 * Read one document that is not JSON.
	 * @param path - the API path, such as a job's trace.
	 */
	async text(path: string): Promise<string> {
		const response = await this.request("GET", path);

		return await response.text();
	}

	/** One authenticated call, with the token read at the moment it is made. */
	private async request(
		method: string,
		path: string,
		params?: Readonly<Record<string, Param>>,
		body?: unknown,
	): Promise<Response> {
		const token = await this.deps.token.read();

		if (token === undefined)
			throw new Error(
				"no GitLab personal access token stored; paste one in the GitLab settings card",
			);

		const url = new URL(`${apiRootOf(this.deps.config)}${path}`);

		for (const [name, value] of Object.entries(params ?? {})) {
			if (value !== undefined) url.searchParams.set(name, String(value));
		}

		const response = await fetch(url, {
			method,
			headers: {
				accept: "application/json",
				"private-token": token,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		if (!response.ok) throw await this.failureOf(response);

		return response;
	}

	/** GitLab's own words about a refusal, as one sentence. */
	private async failureOf(response: Response): Promise<Error> {
		const text = await response.text().catch(() => "");
		let message = text.trim();

		try {
			const parsed: unknown = JSON.parse(text);

			if (
				parsed !== null &&
				typeof parsed === "object" &&
				typeof (parsed as { message?: unknown }).message === "string"
			)
				message = (parsed as { message: string }).message;
			else if (
				parsed !== null &&
				typeof parsed === "object" &&
				typeof (parsed as { error?: unknown }).error === "string"
			)
				message = (parsed as { error: string }).error;
		} catch {
			// Not JSON: the body itself is what GitLab said.
		}

		if (response.status === 401)
			return new Error(
				`GitLab refused the token (401): ${message === "" ? "it may have expired, or lack the api scope" : message}`,
			);
		if (response.status === 403)
			return new Error(
				`GitLab refused the request (403): ${message === "" ? "the token's owner may not be allowed to do this" : message}`,
			);

		return new Error(
			`GitLab answered ${response.status} for ${response.url}: ${message}`,
		);
	}
}

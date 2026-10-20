/**
 * The GitLab account a token belongs to.
 *
 * Every scoped list — "waiting for my review", "assigned to me" — is resolved
 * relative to the authenticated user, so the plugin asks once who that is:
 * `GET /user` answers `{id, username, name, web_url}`. The account is learned
 * per connection rather than remembered, because one call at startup is cheaper
 * than a second record to keep in step with the token.
 */

import type { AccountFacts } from "dsh-integration-host";
import { asRecord, pickString } from "dsh-mcp-oauth";
import type { GitLabApi } from "./api";

export class GitLabAccount implements AccountFacts {
	readonly username?: string;
	readonly name?: string;
	readonly webUrl?: string;

	constructor(params: { username?: string; name?: string; webUrl?: string }) {
		this.username = params.username;
		this.name = params.name;
		this.webUrl = params.webUrl;
	}

	/**
	 * Read the account out of `GET /user`.
	 * @param value - the document GitLab answered with.
	 * @returns the account it names, or an empty one.
	 */
	static parse(value: unknown): GitLabAccount {
		const record = asRecord(value);
		if (record === undefined) return new GitLabAccount({});

		const username = pickString(record, "username", "login");
		const name = pickString(record, "name");
		const webUrl = pickString(record, "web_url", "webUrl", "url");

		return new GitLabAccount({
			...(username === undefined ? {} : { username }),
			...(name === undefined ? {} : { name }),
			...(webUrl === undefined ? {} : { webUrl: webUrl.replace(/\/+$/u, "") }),
		});
	}

	/** Whether nothing at all is known yet. */
	get isEmpty(): boolean {
		return this.username === undefined && this.webUrl === undefined;
	}

	/** Whether the username is known, so scoped lists need nothing more. */
	get isComplete(): boolean {
		return this.username !== undefined;
	}
}

/**
 * Ask GitLab who the stored token belongs to.
 * @param api - the channel to GitLab.
 * @throws when GitLab names no account, which a working token always does.
 */
export const readAccount = async (api: GitLabApi): Promise<GitLabAccount> => {
	const account = GitLabAccount.parse(await api.get("/user"));

	if (account.isEmpty)
		throw new Error("GitLab named no account for the stored token");

	return account;
};

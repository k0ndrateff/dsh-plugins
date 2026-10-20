/**
 * The GitLab account this installation works with.
 *
 * Every merge request scope — "waiting for my review", "assigned to me" — is
 * resolved relative to the authenticated user, so the plugin learns who that is
 * once. `get_user` declares its answer: `{id, username, name, state, web_url}`,
 * and `me: true` asks for the token's own account rather than a named one.
 */

import type { FactsReader } from "dsh-integration-host";
import { asRecord, type Grant, mcpJson, pickString } from "dsh-mcp-oauth";

/** The tool whose answer names the authenticated user. */
export const USER_TOOL = "get_user";

export class UserFacts {
	readonly username?: string;
	readonly name?: string;
	readonly userUrl?: string;

	constructor(params: { username?: string; name?: string; userUrl?: string }) {
		this.username = params.username;
		this.name = params.name;
		this.userUrl = params.userUrl;
	}

	/** What the stored grant already knows, if anything. */
	static from(grant: Grant | undefined): UserFacts {
		const extra = grant?.extra;

		return new UserFacts({
			...(typeof extra?.username === "string"
				? { username: extra.username }
				: {}),
			...(typeof extra?.userName === "string" ? { name: extra.userName } : {}),
			...(typeof extra?.userUrl === "string" ? { userUrl: extra.userUrl } : {}),
		});
	}

	/**
	 * Read the account out of `get_user`'s answer.
	 * @param value - the result of `get_user`.
	 * @returns the facts it names, or empty facts when it names none.
	 */
	static parse(value: unknown): UserFacts {
		for (const root of mcpJson(value)) {
			const record = asRecord(root);
			if (record === undefined) continue;

			// A server may wrap the user in a named field; the unwrapped root is
			// what the documented answer looks like.
			const nested = asRecord(record.user) ?? asRecord(record.current_user);
			const source = nested ?? record;
			const username = pickString(source, "username", "login");
			const name = pickString(source, "name");
			const userUrl = pickString(source, "web_url", "webUrl", "url");

			if (username === undefined && userUrl === undefined) continue;

			return new UserFacts({
				...(username === undefined ? {} : { username }),
				...(name === undefined ? {} : { name }),
				...(userUrl === undefined
					? {}
					: { userUrl: userUrl.replace(/\/+$/u, "") }),
			});
		}

		return new UserFacts({});
	}

	/** Whether nothing at all is known yet. */
	get isEmpty(): boolean {
		return this.username === undefined && this.userUrl === undefined;
	}

	/** Whether the username is known, so scoped searches need nothing more. */
	get isComplete(): boolean {
		return this.username !== undefined;
	}
}

/** How GitLab's own account answer is read, merged, and remembered. */
export const userFacts: FactsReader<UserFacts> = {
	toolName: USER_TOOL,
	from: (grant) => UserFacts.from(grant),
	parse: (value) => UserFacts.parse(value),
	merge: (known, learned) =>
		new UserFacts({
			username: learned.username ?? known?.username,
			name: learned.name ?? known?.name,
			userUrl: learned.userUrl ?? known?.userUrl,
		}),
	remember: (facts) => ({
		...(facts.username === undefined ? {} : { username: facts.username }),
		...(facts.name === undefined ? {} : { userName: facts.name }),
		...(facts.userUrl === undefined ? {} : { userUrl: facts.userUrl }),
	}),
};

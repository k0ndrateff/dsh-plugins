/**
 * The personal access token this installation works with.
 *
 * GitLab's MCP server issues its own tokens, but a REST integration cannot use
 * one: the `mcp` scope is only accepted at the MCP endpoint. What GitLab does
 * offer is a personal access token, so the user pastes one and it is kept where
 * every other secret in the harness lives — the credential store, under this
 * plugin's own key. Nothing else in this plugin ever reads it.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	type CredentialKey,
	credentialKey,
} from "@deepseek-ai/dsh-credentials";

/** The record key is the plugin's own name, as the credential seam requires. */
const PLUGIN_SCOPE = "dsh-gitlab";

/** The credential record this plugin's token lives in: `dsh-gitlab/token`. */
export const TOKEN_KEY = credentialKey(PLUGIN_SCOPE, "token");

export class TokenStore {
	/** The one record this plugin owns. */
	private readonly key: CredentialKey = TOKEN_KEY;

	/**
	 * @param ctx - host context carrying the credential store.
	 */
	constructor(private readonly ctx: Context) {}

	/** Read the stored token, or undefined when the user has not pasted one. */
	async read(): Promise<string | undefined> {
		const record = await this.ctx.credentials.readRecord(this.key);

		if (record === undefined || record.kind !== "api-key") return undefined;

		const key = record.key;

		return typeof key === "string" && key !== "" ? key : undefined;
	}

	/**
	 * Store one token, replacing whatever was there.
	 * @param token - the personal access token, as the user pasted it.
	 */
	async save(token: string): Promise<void> {
		const trimmed = token.trim();

		if (trimmed === "") throw new Error("a personal access token is required");

		await this.ctx.credentials.modifyRecord(this.key, async () => ({
			kind: "api-key",
			key: trimmed,
		}));
	}

	/** Forget the token entirely. */
	async clear(): Promise<void> {
		await this.ctx.credentials.deleteRecord(this.key);
	}
}

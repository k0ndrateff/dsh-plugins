/**
 * Offline checks for the GitLab host half.
 *
 * Everything here is a pure decision: how the profile patch is normalized,
 * where the token is kept, and how the account's own answer is read. The live
 * half — a real token against gitlab.com — is proved by the plugin running
 * rather than by this file.
 *
 *   bun run test/dry-run.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import { GitLabAccount, readAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { apiRootOf, DEFAULT_ENDPOINT, resolveConfig } from "../src/host/config";
import { TOKEN_KEY, TokenStore } from "../src/host/token";

/** An in-memory credential store, shaped like the harness's own seam. */
function fakeCredentials(): { ctx: Context; records: Map<string, unknown> } {
	const records = new Map<string, unknown>();

	const ctx = {
		credentials: {
			readRecord: async (key: string) => records.get(key),
			modifyRecord: async (
				key: string,
				mutate: (current: unknown) => Promise<unknown>,
			) => {
				const next = await mutate(records.get(key));

				if (next === undefined) return records.get(key);

				records.set(key, next);

				return next;
			},
			deleteRecord: async (key: string) => {
				records.delete(key);
			},
		},
	} as unknown as Context;

	return { ctx, records };
}

/** A channel to GitLab that answers from a script. */
function fakeApi(answers: (path: string) => unknown): GitLabApi {
	return {
		get: async (path: string) => answers(path),
	} as unknown as GitLabApi;
}

test("configuration", async () => {
	expect(
		resolveConfig(undefined).endpoint === DEFAULT_ENDPOINT &&
			resolveConfig(undefined).debug === false,
		`an empty patch falls back to gitlab.com — ${JSON.stringify(resolveConfig(undefined))}`,
	).toBe(true);
	expect(
		resolveConfig({ endpoint: "https://gitlab.example/" }).endpoint ===
			"https://gitlab.example",
		`a self-hosted instance is kept, without its trailing slash — ${resolveConfig({ endpoint: "https://gitlab.example/" }).endpoint}`,
	).toBe(true);
	expect(
		resolveConfig({ endpoint: 42 }).endpoint === DEFAULT_ENDPOINT &&
			resolveConfig({ endpoint: "   " }).endpoint === DEFAULT_ENDPOINT,
		"an endpoint that is not a string falls back rather than failing activation",
	).toBe(true);
	expect(
		resolveConfig({}).debug === false &&
			resolveConfig({ debug: true }).debug === true,
		"debug is off unless asked for",
	).toBe(true);
	expect(
		apiRootOf(resolveConfig({ endpoint: "https://gitlab.example/" })) ===
			"https://gitlab.example/api/v4",
		`every call is made under the instance's API root — ${apiRootOf(resolveConfig({ endpoint: "https://gitlab.example/" }))}`,
	).toBe(true);
});
test("the token record", async () => {
	const { ctx, records } = fakeCredentials();
	const store = new TokenStore(ctx);

	expect(
		TOKEN_KEY === "dsh-gitlab/token",
		`the token lives under the plugin's own record — ${String(TOKEN_KEY)}`,
	).toBe(true);
	expect(
		(await store.read()) === undefined,
		"nothing is stored before the user pastes one",
	).toBe(true);

	await store.save("  glpat-abc  ");

	expect(
		(await store.read()) === "glpat-abc" &&
			(records.get(TOKEN_KEY as string) as { kind?: string } | undefined)
				?.kind === "api-key",
		`a pasted token is stored, trimmed of the whitespace around it — ${JSON.stringify(await store.read())}`,
	).toBe(true);
	expect(
		(records.get(TOKEN_KEY as string) as { kind?: string } | undefined)
			?.kind === "api-key",
		"the record is an api key rather than a grant, because nothing issued it",
	).toBe(true);

	await store.save("glpat-second");

	expect(
		(await store.read()) === "glpat-second",
		"pasting another token replaces the first",
	).toBe(true);

	let refused = "";
	try {
		await store.save("   ");
	} catch (error) {
		refused = error instanceof Error ? error.message : String(error);
	}

	expect(
		refused !== "" && (await store.read()) === "glpat-second",
		`an empty token is refused rather than stored — ${refused}`,
	).toBe(true);

	await store.clear();

	expect(
		(await store.read()) === undefined,
		"forgetting the token removes the record",
	).toBe(true);

	const wrongKind = fakeCredentials();
	wrongKind.records.set(TOKEN_KEY as string, { kind: "grant", payload: {} });

	expect(
		(await new TokenStore(wrongKind.ctx).read()) === undefined,
		"a record of another kind reads as no token",
	).toBe(true);
});
test("the account answer", async () => {
	const USER = {
		id: 42,
		username: "ada",
		name: "Ada Lovelace",
		state: "active",
		web_url: "https://gitlab.com/ada",
	};

	expect(
		GitLabAccount.parse(USER).username === "ada" &&
			GitLabAccount.parse(USER).name === "Ada Lovelace",
		"the authenticated user is read from the answer",
	).toBe(true);
	expect(
		GitLabAccount.parse({ ...USER, web_url: "https://gitlab.com/ada/" })
			.webUrl === "https://gitlab.com/ada",
		"its profile URL is kept without the trailing slash",
	).toBe(true);
	expect(
		GitLabAccount.parse({}).isEmpty && GitLabAccount.parse(undefined).isEmpty,
		"an answer that names no user reads as empty",
	).toBe(true);
	expect(
		GitLabAccount.parse(USER).isComplete,
		"a known username needs nothing more learned",
	).toBe(true);

	expect(
		(await readAccount(fakeApi(() => USER))).username === "ada",
		"the account is asked for once, at /user",
	).toBe(true);

	let missing = "";
	try {
		await readAccount(fakeApi(() => ({})));
	} catch (error) {
		missing = error instanceof Error ? error.message : String(error);
	}

	expect(
		missing.includes("named no account"),
		`an answer that names no account is refused — ${missing}`,
	).toBe(true);
});

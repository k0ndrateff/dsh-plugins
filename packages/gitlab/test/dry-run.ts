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

import type { Context } from "@deepseek-ai/cordis";
import { GitLabAccount, readAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { apiRootOf, DEFAULT_ENDPOINT, resolveConfig } from "../src/host/config";
import { TOKEN_KEY, TokenStore } from "../src/host/token";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

console.log("\n=== configuration ===");

check(
	"an empty patch falls back to gitlab.com",
	resolveConfig(undefined).endpoint === DEFAULT_ENDPOINT &&
		resolveConfig(undefined).debug === false,
	JSON.stringify(resolveConfig(undefined)),
);
check(
	"a self-hosted instance is kept, without its trailing slash",
	resolveConfig({ endpoint: "https://gitlab.example/" }).endpoint ===
		"https://gitlab.example",
	resolveConfig({ endpoint: "https://gitlab.example/" }).endpoint,
);
check(
	"an endpoint that is not a string falls back rather than failing activation",
	resolveConfig({ endpoint: 42 }).endpoint === DEFAULT_ENDPOINT &&
		resolveConfig({ endpoint: "   " }).endpoint === DEFAULT_ENDPOINT,
);
check(
	"debug is off unless asked for",
	resolveConfig({}).debug === false &&
		resolveConfig({ debug: true }).debug === true,
);
check(
	"every call is made under the instance's API root",
	apiRootOf(resolveConfig({ endpoint: "https://gitlab.example/" })) ===
		"https://gitlab.example/api/v4",
	apiRootOf(resolveConfig({ endpoint: "https://gitlab.example/" })),
);

console.log("\n=== the token record ===");

const { ctx, records } = fakeCredentials();
const store = new TokenStore(ctx);

check(
	"the token lives under the plugin's own record",
	TOKEN_KEY === "dsh-gitlab/token",
	String(TOKEN_KEY),
);
check(
	"nothing is stored before the user pastes one",
	(await store.read()) === undefined,
);

await store.save("  glpat-abc  ");

check(
	"a pasted token is stored, trimmed of the whitespace around it",
	(await store.read()) === "glpat-abc" &&
		(records.get(TOKEN_KEY as string) as { kind?: string } | undefined)
			?.kind === "api-key",
	JSON.stringify(await store.read()),
);
check(
	"the record is an api key rather than a grant, because nothing issued it",
	(records.get(TOKEN_KEY as string) as { kind?: string } | undefined)?.kind ===
		"api-key",
);

await store.save("glpat-second");

check(
	"pasting another token replaces the first",
	(await store.read()) === "glpat-second",
);

let refused = "";
try {
	await store.save("   ");
} catch (error) {
	refused = error instanceof Error ? error.message : String(error);
}

check(
	"an empty token is refused rather than stored",
	refused !== "" && (await store.read()) === "glpat-second",
	refused,
);

await store.clear();

check(
	"forgetting the token removes the record",
	(await store.read()) === undefined,
);

const wrongKind = fakeCredentials();
wrongKind.records.set(TOKEN_KEY as string, { kind: "grant", payload: {} });

check(
	"a record of another kind reads as no token",
	(await new TokenStore(wrongKind.ctx).read()) === undefined,
);

console.log("\n=== the account answer ===");

const USER = {
	id: 42,
	username: "ada",
	name: "Ada Lovelace",
	state: "active",
	web_url: "https://gitlab.com/ada",
};

check(
	"the authenticated user is read from the answer",
	GitLabAccount.parse(USER).username === "ada" &&
		GitLabAccount.parse(USER).name === "Ada Lovelace",
);
check(
	"its profile URL is kept without the trailing slash",
	GitLabAccount.parse({ ...USER, web_url: "https://gitlab.com/ada/" })
		.webUrl === "https://gitlab.com/ada",
);
check(
	"an answer that names no user reads as empty",
	GitLabAccount.parse({}).isEmpty && GitLabAccount.parse(undefined).isEmpty,
);
check(
	"a known username needs nothing more learned",
	GitLabAccount.parse(USER).isComplete,
);

check(
	"the account is asked for once, at /user",
	(await readAccount(fakeApi(() => USER))).username === "ada",
);

let missing = "";
try {
	await readAccount(fakeApi(() => ({})));
} catch (error) {
	missing = error instanceof Error ? error.message : String(error);
}

check(
	"an answer that names no account is refused",
	missing.includes("named no account"),
	missing,
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

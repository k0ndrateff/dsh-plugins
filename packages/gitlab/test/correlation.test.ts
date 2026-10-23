/**
 * The correlation source: what GitLab contributes to a chain.
 *
 * Two decisions carry the weight here, and both are about what GitLab is allowed
 * to claim: which project a commit reference names (read out of a link, and only
 * when the link is this instance's), and which tracker key a merge request names
 * (its title, or a branch where separators stand in for spaces).
 *
 *   bun run test/correlation.ts
 */

import { expect, test } from "bun:test";
import type { GitLabApi } from "../src/host/api";
import type { GitLabConfig } from "../src/host/config";
import { gitLabCorrelationSource } from "../src/host/correlation";

const COMMIT = {
	id: "7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
	title: "DEV-5977: Handle split 500 error codes",
	author_name: "Grace Hopper",
	created_at: "2026-10-20T09:00:00.000Z",
	web_url:
		"https://gitlab.com/acme/storefront/-/commit/7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
};

const REQUESTS = [
	{ iid: 42, project_id: 7, title: "Handle split codes" },
	{ iid: 43, project_id: 7, title: "Backport" },
];

const REQUEST = {
	iid: 42,
	title: "DEV-5977: Handle split codes",
	source_branch: "dev-5977-split-codes",
	state: "opened",
	author: { name: "Ada Lovelace", username: "ada" },
	web_url: "https://gitlab.com/acme/storefront/-/merge_requests/42",
};

const calls: string[] = [];

const api = {
	get: async (path: string) => {
		calls.push(path);

		if (path.endsWith("/merge_requests") && path.includes("/commits/"))
			return REQUESTS;
		if (path.includes("/repository/commits/")) return COMMIT;

		return REQUEST;
	},
} as unknown as GitLabApi;

const config: GitLabConfig = { endpoint: "https://gitlab.com", debug: false };
const source = gitLabCorrelationSource({ api, config });

test("what the source offers", async () => {
	expect(
		source.provider === "GitLab" &&
			source.entry === "change" &&
			source.resolves.join(",") === "commit,change",
		`two kinds, so a chain can enter at a merge request or at a commit — ${`${source.provider} · ${source.entry} · ${source.resolves.join(",")}`}`,
	).toBe(true);
});
test("a commit", async () => {
	{
		calls.length = 0;

		const facts = await source.resolve({
			kind: "commit",
			sha: "7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
			url: "https://gitlab.com/acme/storefront/-/blob/c379884/src/capture.ts",
			repository: "Acme / storefront",
			label: "Suspect commit 7c50a1e",
		});
		const fact = facts[0];

		expect(
			calls[0] ===
				"/projects/acme%2Fstorefront/repository/commits/7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
			`the project is read out of the link, not out of the display name — ${calls[0] ?? ""}`,
		).toBe(true);
		expect(
			calls.length === 2 &&
				calls[1] ===
					"/projects/acme%2Fstorefront/repository/commits/7c50a1e57b5a523da90bef0df35f5a6d87b772ed/merge_requests",
			`and both the commit and the merge requests that contain it are asked for — ${calls.join("\n")}`,
		).toBe(true);
		expect(
			fact?.id ===
				"gitlab:acme/storefront@7c50a1e57b5a523da90bef0df35f5a6d87b772ed" &&
				fact.kind === "commit" &&
				fact.label === "Commit" &&
				fact.title === "7c50a1e · DEV-5977: Handle split 500 error codes" &&
				fact.meta === "Grace Hopper · 2026-10-20" &&
				fact.url === COMMIT.web_url,
			`the hop is the commit, with GitLab's own words for it — ${JSON.stringify(fact)}`,
		).toBe(true);
		expect(
			fact?.references?.length === 2 &&
				fact.references[0]?.kind === "change" &&
				fact.references[0].repository === "acme/storefront" &&
				fact.references[0].number === "42" &&
				fact.references[0].label === "acme/storefront!42",
			`and points at every merge request that contains it — ${JSON.stringify(fact?.references)}`,
		).toBe(true);
	}
});
test("what it declines", async () => {
	{
		calls.length = 0;

		expect(
			(
				await source.resolve({
					kind: "commit",
					sha: "7c50a1e5",
					url: "https://github.example/acme/storefront/-/blob/main/src/x.ts",
				})
			).length === 0 && calls.length === 0,
			`a commit from another code host is not GitLab's to answer for — ${calls.join(", ")}`,
		).toBe(true);

		calls.length = 0;

		const byPath = await source.resolve({
			kind: "commit",
			sha: "7c50a1e5",
			repository: "acme/storefront",
		});

		expect(
			byPath.length === 1 &&
				calls[0] === "/projects/acme%2Fstorefront/repository/commits/7c50a1e5",
			`a reference with only a project path still resolves — ${calls[0] ?? ""}`,
		).toBe(true);

		expect(
			(await source.resolve({ kind: "task", key: "DEV-1" })).length === 0,
			"a reference of another kind is not its business",
		).toBe(true);
	}
});
test("a merge request", async () => {
	{
		calls.length = 0;

		const facts = await source.resolve({
			kind: "change",
			repository: "acme/storefront",
			number: "42",
		});
		const fact = facts[0];

		expect(
			calls[0] === "/projects/acme%2Fstorefront/merge_requests/42",
			`one request is read by its project and number — ${calls[0] ?? ""}`,
		).toBe(true);
		expect(
			fact?.id === "gitlab:acme/storefront!42" &&
				fact.label === "Merge request" &&
				fact.title === "acme/storefront!42 · DEV-5977: Handle split codes" &&
				fact.meta === "opened · Ada Lovelace",
			`the hop is the request, in GitLab's own words — ${JSON.stringify(fact)}`,
		).toBe(true);
		expect(
			fact?.references?.length === 1 &&
				fact.references[0]?.kind === "task" &&
				fact.references[0].key === "DEV-5977",
			`the key in the title is pointed at, once, though the branch names it too — ${JSON.stringify(fact?.references)}`,
		).toBe(true);
	}
});
test("a branch that names a key differently", async () => {
	{
		const branched = gitLabCorrelationSource({
			api: {
				get: async () => ({ ...REQUEST, title: "Handle split codes" }),
			} as unknown as GitLabApi,
			config,
		});
		const facts = await branched.resolve({
			kind: "change",
			repository: "acme/storefront",
			number: "42",
		});

		expect(
			facts[0]?.references?.[0]?.kind === "task" &&
				facts[0].references[0].key === "DEV-5977",
			`a branch spelling the key with separators still names the ticket — ${JSON.stringify(facts[0]?.references)}`,
		).toBe(true);

		const versioned = gitLabCorrelationSource({
			api: {
				get: async () => ({
					...REQUEST,
					title: "Bump lodash",
					source_branch: "dependabot/npm_and_yarn/lodash-4.17.21",
				}),
			} as unknown as GitLabApi,
			config,
		});
		const bumped = await versioned.resolve({
			kind: "change",
			repository: "acme/storefront",
			number: "42",
		});

		expect(
			(bumped[0]?.references ?? []).length === 0,
			`a package version in a branch is not a ticket — ${JSON.stringify(bumped[0]?.references)}`,
		).toBe(true);
	}
});

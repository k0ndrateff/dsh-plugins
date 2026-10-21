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

import type { GitLabApi } from "../src/host/api";
import type { GitLabConfig } from "../src/host/config";
import { gitLabCorrelationSource } from "../src/host/correlation";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

console.log("\n=== what the source offers ===");
check(
	"two kinds, so a chain can enter at a merge request or at a commit",
	source.provider === "GitLab" &&
		source.entry === "change" &&
		source.resolves.join(",") === "commit,change",
	`${source.provider} · ${source.entry} · ${source.resolves.join(",")}`,
);

console.log("\n=== a commit ===");
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

	check(
		"the project is read out of the link, not out of the display name",
		calls[0] ===
			"/projects/acme%2Fstorefront/repository/commits/7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
		calls[0] ?? "",
	);
	check(
		"and both the commit and the merge requests that contain it are asked for",
		calls.length === 2 &&
			calls[1] ===
				"/projects/acme%2Fstorefront/repository/commits/7c50a1e57b5a523da90bef0df35f5a6d87b772ed/merge_requests",
		calls.join("\n"),
	);
	check(
		"the hop is the commit, with GitLab's own words for it",
		fact?.id ===
			"gitlab:acme/storefront@7c50a1e57b5a523da90bef0df35f5a6d87b772ed" &&
			fact.kind === "commit" &&
			fact.label === "Commit" &&
			fact.title === "7c50a1e · DEV-5977: Handle split 500 error codes" &&
			fact.meta === "Grace Hopper · 2026-10-20" &&
			fact.url === COMMIT.web_url,
		JSON.stringify(fact),
	);
	check(
		"and points at every merge request that contains it",
		fact?.references?.length === 2 &&
			fact.references[0]?.kind === "change" &&
			fact.references[0].repository === "acme/storefront" &&
			fact.references[0].number === "42" &&
			fact.references[0].label === "acme/storefront!42",
		JSON.stringify(fact?.references),
	);
}

console.log("\n=== what it declines ===");
{
	calls.length = 0;

	check(
		"a commit from another code host is not GitLab's to answer for",
		(
			await source.resolve({
				kind: "commit",
				sha: "7c50a1e5",
				url: "https://github.example/acme/storefront/-/blob/main/src/x.ts",
			})
		).length === 0 && calls.length === 0,
		calls.join(", "),
	);

	calls.length = 0;

	const byPath = await source.resolve({
		kind: "commit",
		sha: "7c50a1e5",
		repository: "acme/storefront",
	});

	check(
		"a reference with only a project path still resolves",
		byPath.length === 1 &&
			calls[0] === "/projects/acme%2Fstorefront/repository/commits/7c50a1e5",
		calls[0] ?? "",
	);

	check(
		"a reference of another kind is not its business",
		(await source.resolve({ kind: "task", key: "DEV-1" })).length === 0,
	);
}

console.log("\n=== a merge request ===");
{
	calls.length = 0;

	const facts = await source.resolve({
		kind: "change",
		repository: "acme/storefront",
		number: "42",
	});
	const fact = facts[0];

	check(
		"one request is read by its project and number",
		calls[0] === "/projects/acme%2Fstorefront/merge_requests/42",
		calls[0] ?? "",
	);
	check(
		"the hop is the request, in GitLab's own words",
		fact?.id === "gitlab:acme/storefront!42" &&
			fact.label === "Merge request" &&
			fact.title === "acme/storefront!42 · DEV-5977: Handle split codes" &&
			fact.meta === "opened · Ada Lovelace",
		JSON.stringify(fact),
	);
	check(
		"the key in the title is pointed at, once, though the branch names it too",
		fact?.references?.length === 1 &&
			fact.references[0]?.kind === "task" &&
			fact.references[0].key === "DEV-5977",
		JSON.stringify(fact?.references),
	);
}

console.log("\n=== a branch that names a key differently ===");
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

	check(
		"a branch spelling the key with separators still names the ticket",
		facts[0]?.references?.[0]?.kind === "task" &&
			facts[0].references[0].key === "DEV-5977",
		JSON.stringify(facts[0]?.references),
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

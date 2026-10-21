/**
 * The digest source: which list each block asks GitLab for, and which review
 * notes the CodeRabbit block is allowed to report.
 *
 *   bun run test/digest.ts
 *
 * The CodeRabbit block is the only part of the digest that filters a provider's
 * answer rather than just reading it, so the filter is what this file is mostly
 * about: the author, the window, and GitLab's own activity notes.
 */

import type { RuntimeState } from "dsh-integration-host";
import type { GitLabAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { firstLineOf, gitlabDigestSource } from "../src/host/digest";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

interface Call {
	readonly path: string;
	readonly params: Readonly<Record<string, unknown>> | undefined;
}

const MERGE_REQUESTS = {
	merge_requests: [
		{
			iid: 12,
			title: "Add the digest",
			project_id: 7,
			web_url: "https://gitlab.com/acme/app/-/merge_requests/12",
			state: "opened",
			updated_at: "2026-10-21T05:00:00.000Z",
			references: { full: "acme/app!12" },
			pipeline: { status: "failed" },
		},
	],
};

/** Discussions as GitLab returns them: two bots, one human, one system note. */
const DISCUSSIONS = {
	discussions: [
		{
			id: "d1",
			resolved: false,
			notes: [
				{
					id: "n1",
					author: { username: "coderabbitai", bot: true },
					body: "## Summary\n\nConsider a guard clause here.",
					created_at: "2026-10-21T05:30:00.000Z",
					system: false,
					resolvable: true,
				},
				{
					id: "n2",
					author: { username: "coderabbitai", bot: true },
					body: "An old remark from last week.",
					created_at: "2026-10-10T05:30:00.000Z",
					system: false,
					resolvable: true,
				},
				{
					id: "n3",
					author: { username: "human", bot: false },
					body: "I disagree with the bot.",
					created_at: "2026-10-21T05:40:00.000Z",
					system: false,
					resolvable: true,
				},
				{
					id: "n4",
					author: { username: "coderabbitai", bot: true },
					body: "changed the description",
					created_at: "2026-10-21T05:45:00.000Z",
					system: true,
					resolvable: false,
				},
			],
		},
	],
};

const calls: Call[] = [];

const api = {
	get: async (path: string, params?: Record<string, unknown>) => {
		calls.push({ path, params });

		return path.endsWith("/discussions") ? DISCUSSIONS : MERGE_REQUESTS;
	},
	getAnswer: async (path: string, params?: Record<string, unknown>) => {
		calls.push({ path, params });

		return { value: MERGE_REQUESTS, total: 1 };
	},
} as unknown as GitLabApi;

const state = {
	facts: { username: "mak", name: "Mak", webUrl: "https://gitlab.com" },
} as unknown as RuntimeState<GitLabAccount>;

const source = gitlabDigestSource({ api, state });

console.log("=== what the source offers ===");
{
	check(
		"three blocks, with the bot's off by default",
		source.blocks.map((block) => `${block.id}:${block.defaultOn}`).join(",") ===
			"gitlab-review:true,gitlab-mine:true,coderabbit:false",
		source.blocks.map((block) => block.id).join(","),
	);
	check("it names its provider", source.provider === "GitLab");
}

console.log("\n=== waiting for my review ===");
{
	const items = await source.load("gitlab-review", {
		since: new Date(0),
		limit: 10,
	});
	const call = calls.at(-1);

	check(
		"asks the merge request list",
		call?.path === "/merge_requests",
		call?.path,
	);
	check("for open work", call?.params?.state === "opened");
	check(
		"reviewed by the signed-in user, which is how GitLab spells that scope",
		call?.params?.reviewer_username === "mak",
		String(call?.params?.reviewer_username),
	);
	check(
		"capped and newest first",
		call?.params?.per_page === 10 && call?.params?.sort === "desc",
	);
	check(
		"a row leads with the reference and the title",
		items[0]?.title === "acme/app!12 · Add the digest",
		items[0]?.title,
	);
	check(
		"and carries the pipeline beside it",
		items[0]?.meta === "opened · failed",
		items[0]?.meta,
	);
	check(
		"with a link to the merge request",
		items[0]?.url?.endsWith("/merge_requests/12") === true,
	);
}

console.log("\n=== my merge requests ===");
{
	await source.load("gitlab-mine", { since: new Date(0), limit: 10 });

	check(
		"asks for the ones the user created",
		calls.at(-1)?.params?.scope === "created_by_me",
		String(calls.at(-1)?.params?.scope),
	);
	check(
		"and does not pretend to be a review filter",
		calls.at(-1)?.params?.reviewer_username === undefined,
	);
}

console.log("\n=== the bot's review notes ===");
{
	const since = new Date("2026-10-21T00:00:00.000Z");
	const items = await source.load("coderabbit", { since, limit: 10 });

	check(
		"one row for the note inside the window",
		items.length === 1,
		String(items.length),
	);
	check(
		"titled by the note's own first line, with the markdown heading dropped",
		items[0]?.title === "Summary",
		items[0]?.title,
	);
	check(
		"naming the merge request and the author",
		items[0]?.meta === "acme/app!12 · coderabbitai",
		items[0]?.meta,
	);
	check(
		"and linking to the note",
		items[0]?.url === "https://gitlab.com/acme/app/-/merge_requests/12#note_n1",
		items[0]?.url,
	);
}

console.log("\n=== reading a note's first line ===");
{
	check(
		"a heading is dropped",
		firstLineOf("## Summary\n\nbody") === "Summary",
	);
	check(
		"a quote marker is dropped",
		firstLineOf("> Consider this") === "Consider this",
	);
	check(
		"leading blank lines are skipped",
		firstLineOf("\n\n  Real text  ") === "Real text",
	);
	check(
		"a long line is bounded",
		(firstLineOf(`x${"y".repeat(300)}`) ?? "").length === 158,
	);
	check("an empty note says nothing", firstLineOf("\n \n") === "");
}

console.log("\n=== what it refuses ===");
{
	const unknown = await source
		.load("gitlab-nonsense", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	check(
		"an unknown block is an error",
		unknown.includes("no GitLab block"),
		unknown,
	);

	const noAccount = gitlabDigestSource({
		api,
		state: { facts: undefined } as unknown as RuntimeState<GitLabAccount>,
	});
	const missing = await noAccount
		.load("gitlab-review", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	check(
		"an account that is not known yet says which command learns it",
		missing.includes("/gitlab sync"),
		missing,
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

process.exit(failures > 0 ? 1 : 0);

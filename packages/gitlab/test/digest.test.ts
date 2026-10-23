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

import { expect, test } from "bun:test";
import type { RuntimeState } from "dsh-integration-host";
import type { GitLabAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { firstLineOf, gitlabDigestSource } from "../src/host/digest";

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
	getAll: async (path: string, params?: Record<string, unknown>) => {
		calls.push({ path, params });

		return {
			items: path.endsWith("/discussions") ? DISCUSSIONS : [],
			truncated: false,
		};
	},
} as unknown as GitLabApi;

const state = {
	facts: { username: "mak", name: "Mak", webUrl: "https://gitlab.com" },
} as unknown as RuntimeState<GitLabAccount>;

const source = gitlabDigestSource({ api, state });

console.log("=== what the source offers ===");
expect(
	source.blocks.map((block) => `${block.id}:${block.defaultOn}`).join(",") ===
		"gitlab-review:true,gitlab-mine:true,coderabbit:false",
	`three blocks, with the bot's off by default — ${source.blocks.map((block) => block.id).join(",")}`,
).toBe(true);

test("waiting for my review", async () => {
	{
		const items = await source.load("gitlab-review", {
			since: new Date(0),
			limit: 10,
		});
		const call = calls.at(-1);

		expect(
			call?.path === "/merge_requests",
			`asks the merge request list — ${call?.path}`,
		).toBe(true);
		expect(call?.params?.state === "opened", "for open work").toBe(true);
		expect(
			call?.params?.reviewer_username === "mak",
			`reviewed by the signed-in user, which is how GitLab spells that scope — ${String(call?.params?.reviewer_username)}`,
		).toBe(true);
		expect(
			call?.params?.per_page === 10 && call?.params?.sort === "desc",
			"capped and newest first",
		).toBe(true);
		expect(
			items[0]?.title === "acme/app!12 · Add the digest",
			`a row leads with the reference and the title — ${items[0]?.title}`,
		).toBe(true);
		expect(
			items[0]?.meta === "opened · failed",
			`and carries the pipeline beside it — ${items[0]?.meta}`,
		).toBe(true);
		expect(
			items[0]?.url?.endsWith("/merge_requests/12") === true,
			"with a link to the merge request",
		).toBe(true);
	}
});
test("my merge requests", async () => {
	await source.load("gitlab-mine", { since: new Date(0), limit: 10 });

	expect(
		calls.at(-1)?.params?.scope === "created_by_me",
		`asks for the ones the user created — ${String(calls.at(-1)?.params?.scope)}`,
	).toBe(true);
	expect(
		calls.at(-1)?.params?.reviewer_username === undefined,
		"and does not pretend to be a review filter",
	).toBe(true);
});
test("the bot's review notes", async () => {
	{
		const since = new Date("2026-10-21T00:00:00.000Z");
		const items = await source.load("coderabbit", { since, limit: 10 });

		expect(
			items.length === 1,
			`one row for the note inside the window — ${String(items.length)}`,
		).toBe(true);
		expect(
			items[0]?.title === "Summary",
			`titled by the note's own first line, with the markdown heading dropped — ${items[0]?.title}`,
		).toBe(true);
		expect(
			items[0]?.meta === "acme/app!12 · coderabbitai",
			`naming the merge request and the author — ${items[0]?.meta}`,
		).toBe(true);
		expect(
			items[0]?.url ===
				"https://gitlab.com/acme/app/-/merge_requests/12#note_n1",
			`and linking to the note — ${items[0]?.url}`,
		).toBe(true);
	}
});
test("reading a note's first line", async () => {
	expect(
		firstLineOf("## Summary\n\nbody") === "Summary",
		"a heading is dropped",
	).toBe(true);
	expect(
		firstLineOf("> Consider this") === "Consider this",
		"a quote marker is dropped",
	).toBe(true);
	expect(
		firstLineOf("\n\n  Real text  ") === "Real text",
		"leading blank lines are skipped",
	).toBe(true);
	expect(
		(firstLineOf(`x${"y".repeat(300)}`) ?? "").length === 158,
		"a long line is bounded",
	).toBe(true);
	expect(firstLineOf("\n \n") === "", "an empty note says nothing").toBe(true);
});
test("what it refuses", async () => {
	{
		const unknown = await source
			.load("gitlab-nonsense", { since: new Date(0), limit: 5 })
			.then(() => "")
			.catch((error: unknown) => (error as Error).message);

		expect(
			unknown.includes("no GitLab block"),
			`an unknown block is an error — ${unknown}`,
		).toBe(true);

		const noAccount = gitlabDigestSource({
			api,
			state: { facts: undefined } as unknown as RuntimeState<GitLabAccount>,
		});
		const missing = await noAccount
			.load("gitlab-review", { since: new Date(0), limit: 5 })
			.then(() => "")
			.catch((error: unknown) => (error as Error).message);

		expect(
			missing.includes("/gitlab sync"),
			`an account that is not known yet says which command learns it — ${missing}`,
		).toBe(true);
	}
});

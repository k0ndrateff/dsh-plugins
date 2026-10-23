/**
 * The GitLab readers against recorded shapes.
 *
 * The fixtures below follow GitLab's REST API as its own documentation describes
 * it: `GET /merge_requests`, `GET /merge_requests/:iid`, `.../diffs`,
 * `.../discussions`, `.../pipelines`, `.../pipelines/:id/jobs`, `GET /jobs/:id`.
 * They are the shapes this version was written against, and the live capture
 * taken with the plugin installed is what confirms them.
 *
 * Identifiers are invented: this file ships with the repository.
 *
 *   bun run test/readers.ts
 */

import { expect, test } from "bun:test";
import { readJobLog } from "../src/client/ansi";
import {
	findingOf,
	parseDiffFiles,
	parseDiscussions,
	parseJob,
	parseJobs,
	parseMergeRequestCard,
	parseMergeRequestDetail,
	parseMergeRequestList,
	parsePipeline,
	parseReference,
} from "../src/host/presentation/parse";
import { isFinding } from "../src/shared/panel";

test("the merge request list", async () => {
	const LIST = [
		{
			iid: 12,
			title: "Add retry to the uploader",
			state: "opened",
			draft: false,
			web_url: "https://gitlab.com/acme/storefront/-/merge_requests/12",
			source_branch: "fix/uploader-retry",
			target_branch: "main",
			author: { username: "ada", name: "Ada Lovelace" },
			reviewers: [{ username: "grace" }],
			references: { full: "acme/storefront!12" },
			head_pipeline: { id: 9001, status: "failed" },
			user_notes_count: 7,
			unresolved_discussions_count: 3,
			updated_at: "2026-10-20T09:12:00Z",
		},
		{
			iid: 13,
			title: "Draft: Rework the checkout form",
			state: "opened",
			web_url: "https://gitlab.com/acme/storefront/-/merge_requests/13",
			references: { full: "acme/storefront!13" },
		},
	];

	const listed = parseMergeRequestList(LIST);

	expect(
		listed.items.length === 2,
		`a list answers with one row per merge request — ${String(listed.items.length)}`,
	).toBe(true);
	expect(
		listed.items[0]?.project === "acme/storefront" &&
			listed.items[0]?.iid === 12 &&
			listed.items[0]?.title === "Add retry to the uploader",
		`a row carries its project, its id and its title — ${JSON.stringify(listed.items[0])}`,
	).toBe(true);
	expect(
		listed.items[0]?.author === "ada" &&
			listed.items[0]?.reviewers?.join(",") === "grace" &&
			listed.items[0]?.pipeline === "failed",
		`its author, reviewers and pipeline status are read — ${`${listed.items[0]?.author}/${listed.items[0]?.pipeline}`}`,
	).toBe(true);
	expect(
		listed.items[0]?.unresolved === 3 && listed.items[0]?.notes === 7,
		`the unresolved count and the note count are read — ${`${listed.items[0]?.unresolved}/${listed.items[0]?.notes}`}`,
	).toBe(true);
	expect(
		listed.items[1]?.draft === true,
		`a title that says Draft marks the row as a draft — ${String(listed.items[1]?.draft)}`,
	).toBe(true);
	expect(
		listed.items[1]?.project === "acme/storefront" &&
			listed.items[1]?.iid === 13,
		`a row whose project comes from its own reference is read — ${`${listed.items[1]?.project}!${listed.items[1]?.iid}`}`,
	).toBe(true);
	expect(
		parseMergeRequestList([]).items.length === 0 &&
			parseMergeRequestList(undefined).items.length === 0,
		"an answer that lists nothing reads as nothing",
	).toBe(true);
});
const MR = {
	iid: 12,
	title: "Add retry to the uploader",
	description: "Retries the upload three times before giving up.",
	state: "opened",
	draft: false,
	web_url: "https://gitlab.com/acme/storefront/-/merge_requests/12",
	source_branch: "fix/uploader-retry",
	target_branch: "main",
	author: { username: "ada", name: "Ada Lovelace" },
	assignees: [{ username: "grace" }],
	reviewers: [{ username: "grace" }, { username: "linus" }],
	labels: ["backend", "reliability"],
	merge_status: "can_be_merged",
	detailed_merge_status: "mergeable",
	has_conflicts: false,
	user_notes_count: 7,
	sha: "7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
	diff_refs: {
		base_sha: "1111111111111111111111111111111111111111",
		head_sha: "7c50a1e57b5a523da90bef0df35f5a6d87b772ed",
		start_sha: "2222222222222222222222222222222222222222",
	},
	references: { full: "acme/storefront!12" },
	created_at: "2026-10-18T08:00:00Z",
	updated_at: "2026-10-20T09:12:00Z",
};

test("one merge request", async () => {
	const detail = parseMergeRequestDetail(MR, {
		project: "acme/storefront",
		iid: 12,
	});

	expect(
		detail?.title === "Add retry to the uploader" &&
			detail?.state === "opened" &&
			detail?.draft === false &&
			detail?.hasConflicts === false,
		`a merge request's own fields are read — ${JSON.stringify(detail?.state)}`,
	).toBe(true);
	expect(
		detail?.labels.join(",") === "backend,reliability" &&
			detail?.reviewers.length === 2 &&
			detail?.mergeStatus === "mergeable",
		`its labels, reviewers and merge status are read — ${`${detail?.labels.join(",")}/${detail?.mergeStatus}`}`,
	).toBe(true);
	expect(
		detail?.diffHeadSha?.startsWith("7c50a1e") === true,
		`the head sha its comments refer to is read — ${detail?.diffHeadSha}`,
	).toBe(true);
	expect(
		detail?.project === "acme/storefront" && detail?.iid === 12,
		`a merge request the caller named keeps that project and id — ${`${detail?.project}!${detail?.iid}`}`,
	).toBe(true);
	expect(
		parseMergeRequestDetail(
			{ iid: 12 },
			{ project: "acme/storefront", iid: 12 },
		) === undefined,
		"an answer with no title is not read as a merge request",
	).toBe(true);
	expect(
		parseMergeRequestCard(MR)?.iid === 12,
		"one row is read on its own for a card",
	).toBe(true);
});
test("the diff facet", async () => {
	const DIFFS = [
		{
			old_path: "src/uploader.ts",
			new_path: "src/uploader.ts",
			a_mode: "100644",
			b_mode: "100644",
			new_file: false,
			renamed_file: false,
			deleted_file: false,
			diff: '@@ -1,3 +1,6 @@\n import { post } from "./http";\n-const RETRIES = 1;\n+const RETRIES = 3;\n+const DELAY = 250;\n+const TIMEOUT = 5_000;\n',
		},
		{
			new_path: "src/retry.ts",
			new_file: true,
			renamed_file: false,
			deleted_file: false,
			diff: "@@ -0,0 +1,2 @@\n+export const retry = true;\n+export const attempts = 3;\n",
		},
	];

	const diffs = parseDiffFiles(DIFFS);

	expect(
		diffs.length === 2 && diffs[0]?.path === "src/uploader.ts",
		`a diff answers with one entry per file — ${JSON.stringify(diffs.map((file) => file.path))}`,
	).toBe(true);
	expect(
		diffs[0]?.added === 3 && diffs[0]?.removed === 1,
		`the per-file statistics are counted from the patch GitLab sent — ${`+${diffs[0]?.added}/-${diffs[0]?.removed}`}`,
	).toBe(true);
	expect(
		diffs[1]?.newFile === true && diffs[1]?.added === 2,
		`a file the change adds is marked as new — ${String(diffs[1]?.newFile)}`,
	).toBe(true);
	expect(
		diffs[0]?.patch?.includes("-const RETRIES = 1;") === true,
		`the patch text is kept for the diff surface — ${String(diffs[0]?.patch?.length)}`,
	).toBe(true);
	expect(
		parseDiffFiles([]).length === 0,
		"an answer with no diff reads as no files",
	).toBe(true);
});
test("the discussions facet", async () => {
	const DISCUSSIONS = [
		{
			id: "6a9c1b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
			individual_note: false,
			notes: [
				{
					id: 101,
					body: "This retry loop can spin forever: nothing bounds the attempts.",
					system: false,
					resolvable: true,
					resolved: false,
					author: { username: "coderabbitai[bot]" },
					position: {
						new_path: "src/uploader.ts",
						new_line: 42,
						old_line: null,
					},
					created_at: "2026-10-20T09:00:00Z",
				},
				{
					id: 102,
					body: "Bounded it at three attempts in the latest push.",
					system: false,
					resolvable: true,
					resolved: false,
					author: { username: "ada" },
				},
			],
		},
		{
			id: "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
			individual_note: false,
			notes: [
				{
					id: 103,
					body: "Nit: rename this to `attempts`.",
					system: false,
					resolvable: true,
					resolved: true,
					author: { username: "grace" },
					position: { new_path: "src/retry.ts", new_line: 2 },
				},
			],
		},
		{
			id: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
			individual_note: true,
			notes: [
				{
					id: 104,
					body: "added 1 commit",
					system: true,
					resolvable: false,
					resolved: false,
					author: { username: "ada" },
				},
			],
		},
	];

	const discussions = parseDiscussions(DISCUSSIONS);

	expect(
		discussions.length === 3 &&
			discussions[0]?.id === "6a9c1b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b" &&
			discussions[0]?.notes.length === 2,
		`a discussion answers with one thread per id — ${JSON.stringify(discussions.map((thread) => thread.notes.length))}`,
	).toBe(true);
	expect(
		discussions[0]?.resolved === false && discussions[0]?.resolvable === true,
		`a thread is unresolved while any resolvable note is — ${String(discussions[0]?.resolved)}`,
	).toBe(true);
	expect(
		discussions[1]?.resolved === true,
		`a thread whose resolvable notes are all resolved is resolved — ${String(discussions[1]?.resolved)}`,
	).toBe(true);
	expect(
		discussions[2]?.resolvable === false && discussions[2]?.resolved === false,
		`a thread of plain activity is neither resolvable nor resolved — ${JSON.stringify(discussions[2])}`,
	).toBe(true);
	expect(
		parseDiscussions([
			{
				id: "b0t",
				individual_note: false,
				resolvable: true,
				notes: [
					{
						id: 1,
						body: "Nit: rename this.",
						system: false,
						resolvable: true,
						resolved: false,
						author: { username: "code_rabbit_dogedev", bot: true },
						position: { new_path: "src/a.ts", new_line: 3 },
					},
				],
			},
		])[0]?.notes[0]?.author?.bot === true,
		"an author GitLab marked as a bot keeps that flag",
	).toBe(true);
	expect(
		discussions[0]?.notes[0]?.author?.username === "coderabbitai[bot]" &&
			discussions[0]?.notes[0]?.position?.newLine === 42 &&
			discussions[0]?.notes[0]?.position?.file === "src/uploader.ts",
		`a note's author and its position in the diff are read — ${JSON.stringify(discussions[0]?.notes[0]?.position)}`,
	).toBe(true);
	expect(
		discussions[2]?.notes[0]?.system === true,
		`a system note is marked as activity rather than as a comment — ${String(discussions[2]?.notes[0]?.system)}`,
	).toBe(true);
	expect(
		parseDiscussions([]).length === 0 &&
			parseDiscussions(undefined).length === 0,
		"an answer that lists nothing reads as no threads",
	).toBe(true);

	expect(
		isFinding(discussions[0] as never) && isFinding(discussions[1] as never),
		"a thread written against a line of the diff is a finding",
	).toBe(true);
	expect(
		isFinding(discussions[2] as never) === false,
		"a thread of plain activity is not a finding",
	).toBe(true);

	const finding = findingOf(discussions[0] as never, {
		project: "acme/storefront",
		iid: 12,
	});

	expect(
		finding?.kind === "finding" &&
			finding.finding.discussionId === discussions[0]?.id &&
			finding.finding.file === "src/uploader.ts" &&
			finding.finding.line === 42,
		`a finding names its thread, its file and its line — ${JSON.stringify(finding)}`,
	).toBe(true);
	expect(
		finding?.kind === "finding" && finding.finding.resolved === false,
		"a finding says whether the thread is closed",
	).toBe(true);
});
test("the pipeline facet", async () => {
	const PIPELINES = [
		{
			id: 9001,
			iid: 41,
			status: "failed",
			source: "push",
			ref: "fix/uploader-retry",
			web_url: "https://gitlab.com/acme/storefront/-/pipelines/9001",
		},
	];

	const pipeline = parsePipeline(PIPELINES);

	expect(
		pipeline?.id === 9001 &&
			pipeline?.status === "failed" &&
			pipeline?.ref === "fix/uploader-retry",
		`the newest pipeline is read with its status and ref — ${JSON.stringify(pipeline)}`,
	).toBe(true);
	expect(
		parsePipeline([]) === null && parsePipeline(undefined) === null,
		"an answer with no pipeline reads as none",
	).toBe(true);

	const JOBS = [
		{
			id: 88,
			name: "rspec",
			stage: "test",
			status: "failed",
			failure_reason: "script_failure",
			web_url: "https://gitlab.com/acme/storefront/-/jobs/88",
			allow_failure: false,
		},
		{ id: 89, name: "rubocop", stage: "lint", status: "success" },
	];

	const jobs = parseJobs(JOBS);

	expect(
		jobs.length === 2 && jobs[0]?.name === "rspec" && jobs[0]?.stage === "test",
		`a pipeline's jobs are read with their stages — ${JSON.stringify(jobs.map((job) => job.name))}`,
	).toBe(true);
	expect(
		jobs[0]?.status === "failed" && jobs[0]?.failureReason === "script_failure",
		`a failed job keeps GitLab's own reason — ${String(jobs[0]?.failureReason)}`,
	).toBe(true);
});
test("one job", async () => {
	const JOB = {
		id: 88,
		name: "rspec",
		stage: "test",
		status: "failed",
		failure_reason: "script_failure",
		web_url: "https://gitlab.com/acme/storefront/-/jobs/88",
	};

	expect(
		parseJob(JOB)?.id === 88 && parseJob(JOB)?.name === "rspec",
		`a job's own fields are read — ${JSON.stringify(parseJob(JOB))}`,
	).toBe(true);
	expect(
		parseJob({ log: "no job here" }) === undefined,
		"an answer that is not a job reads as none",
	).toBe(true);
});
test("reading a job's trace", async () => {
	expect(
		readJobLog(
			"Running job\u001b[0K\r\n\u001b[31mFAILED\u001b[0m 3 examples\r\n",
		) === "Running job\nFAILED 3 examples\n",
		`escape sequences are consumed rather than printed — ${JSON.stringify(
			readJobLog(
				"Running job\u001b[0K\r\n\u001b[31mFAILED\u001b[0m 3 examples\r\n",
			),
		)}`,
	).toBe(true);
	expect(
		readJobLog("Downloading 10%\rDownloading 90%\rDone\n") === "Done\n",
		`a progress line keeps its final state — ${JSON.stringify(readJobLog("Downloading 10%\rDownloading 90%\rDone\n"))}`,
	).toBe(true);
	expect(
		readJobLog("\u001b]0;title\u0007text\n") === "text\n",
		`an operating-system command is consumed whole — ${JSON.stringify(readJobLog("\u001b]0;title\u0007text\n"))}`,
	).toBe(true);
});
test("a merge request reference", async () => {
	expect(
		parseReference("acme/storefront!12")?.project === "acme/storefront" &&
			parseReference("acme/storefront!12")?.iid === 12,
		"a reference is read as its project and id",
	).toBe(true);
	expect(
		parseReference("https://gitlab.com/acme/storefront/-/merge_requests/12")
			?.iid === 12,
		"a web URL is read as the same reference",
	).toBe(true);
	expect(
		parseReference("storefront") === undefined &&
			parseReference("acme/storefront#12") === undefined,
		"anything else is not a reference",
	).toBe(true);
});
test("the comments GitLab keeps for its own editors", async () => {
	expect(
		parseMergeRequestDetail(
			{
				...MR,
				description: "Retries the upload.\n\n<!-- link the incident -->",
			},
			{ project: "acme/storefront", iid: 12 },
		)?.description === "Retries the upload.",
		"a description carries its prose, not the comment beside it",
	).toBe(true);
	expect(
		parseDiscussions([
			{
				id: "7f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6",
				individual_note: false,
				notes: [
					{
						id: 201,
						body: "Looks good <!-- after the fix --> to me.",
						system: false,
						resolvable: true,
						resolved: false,
						author: { username: "grace" },
					},
				],
			},
		])[0]?.notes[0]?.body === "Looks good to me.",
		"an inline comment in a note leaves the sentence it interrupted",
	).toBe(true);
});

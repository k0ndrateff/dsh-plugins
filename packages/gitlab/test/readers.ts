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

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

console.log("\n=== the merge request list ===");

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

check(
	"a list answers with one row per merge request",
	listed.items.length === 2,
	String(listed.items.length),
);
check(
	"a row carries its project, its id and its title",
	listed.items[0]?.project === "acme/storefront" &&
		listed.items[0]?.iid === 12 &&
		listed.items[0]?.title === "Add retry to the uploader",
	JSON.stringify(listed.items[0]),
);
check(
	"its author, reviewers and pipeline status are read",
	listed.items[0]?.author === "ada" &&
		listed.items[0]?.reviewers?.join(",") === "grace" &&
		listed.items[0]?.pipeline === "failed",
	`${listed.items[0]?.author}/${listed.items[0]?.pipeline}`,
);
check(
	"the unresolved count and the note count are read",
	listed.items[0]?.unresolved === 3 && listed.items[0]?.notes === 7,
	`${listed.items[0]?.unresolved}/${listed.items[0]?.notes}`,
);
check(
	"a title that says Draft marks the row as a draft",
	listed.items[1]?.draft === true,
	String(listed.items[1]?.draft),
);
check(
	"a row whose project comes from its own reference is read",
	listed.items[1]?.project === "acme/storefront" && listed.items[1]?.iid === 13,
	`${listed.items[1]?.project}!${listed.items[1]?.iid}`,
);
check(
	"an answer that lists nothing reads as nothing",
	parseMergeRequestList([]).items.length === 0 &&
		parseMergeRequestList(undefined).items.length === 0,
);

console.log("\n=== one merge request ===");

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

const detail = parseMergeRequestDetail(MR, {
	project: "acme/storefront",
	iid: 12,
});

check(
	"a merge request's own fields are read",
	detail?.title === "Add retry to the uploader" &&
		detail?.state === "opened" &&
		detail?.draft === false &&
		detail?.hasConflicts === false,
	JSON.stringify(detail?.state),
);
check(
	"its labels, reviewers and merge status are read",
	detail?.labels.join(",") === "backend,reliability" &&
		detail?.reviewers.length === 2 &&
		detail?.mergeStatus === "mergeable",
	`${detail?.labels.join(",")}/${detail?.mergeStatus}`,
);
check(
	"the head sha its comments refer to is read",
	detail?.diffHeadSha?.startsWith("7c50a1e") === true,
	detail?.diffHeadSha,
);
check(
	"a merge request the caller named keeps that project and id",
	detail?.project === "acme/storefront" && detail?.iid === 12,
	`${detail?.project}!${detail?.iid}`,
);
check(
	"an answer with no title is not read as a merge request",
	parseMergeRequestDetail(
		{ iid: 12 },
		{ project: "acme/storefront", iid: 12 },
	) === undefined,
);
check(
	"one row is read on its own for a card",
	parseMergeRequestCard(MR)?.iid === 12,
);

console.log("\n=== the diff facet ===");

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

check(
	"a diff answers with one entry per file",
	diffs.length === 2 && diffs[0]?.path === "src/uploader.ts",
	JSON.stringify(diffs.map((file) => file.path)),
);
check(
	"the per-file statistics are counted from the patch GitLab sent",
	diffs[0]?.added === 3 && diffs[0]?.removed === 1,
	`+${diffs[0]?.added}/-${diffs[0]?.removed}`,
);
check(
	"a file the change adds is marked as new",
	diffs[1]?.newFile === true && diffs[1]?.added === 2,
	String(diffs[1]?.newFile),
);
check(
	"the patch text is kept for the diff surface",
	diffs[0]?.patch?.includes("-const RETRIES = 1;") === true,
	String(diffs[0]?.patch?.length),
);
check(
	"an answer with no diff reads as no files",
	parseDiffFiles([]).length === 0,
);

console.log("\n=== the discussions facet ===");

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
				position: { new_path: "src/uploader.ts", new_line: 42, old_line: null },
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

check(
	"a discussion answers with one thread per id",
	discussions.length === 3 &&
		discussions[0]?.id === "6a9c1b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b" &&
		discussions[0]?.notes.length === 2,
	JSON.stringify(discussions.map((thread) => thread.notes.length)),
);
check(
	"a thread is unresolved while any resolvable note is",
	discussions[0]?.resolved === false && discussions[0]?.resolvable === true,
	String(discussions[0]?.resolved),
);
check(
	"a thread whose resolvable notes are all resolved is resolved",
	discussions[1]?.resolved === true,
	String(discussions[1]?.resolved),
);
check(
	"a thread of plain activity is neither resolvable nor resolved",
	discussions[2]?.resolvable === false && discussions[2]?.resolved === false,
	JSON.stringify(discussions[2]),
);
check(
	"an author GitLab marked as a bot keeps that flag",
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
);
check(
	"a note's author and its position in the diff are read",
	discussions[0]?.notes[0]?.author?.username === "coderabbitai[bot]" &&
		discussions[0]?.notes[0]?.position?.newLine === 42 &&
		discussions[0]?.notes[0]?.position?.file === "src/uploader.ts",
	JSON.stringify(discussions[0]?.notes[0]?.position),
);
check(
	"a system note is marked as activity rather than as a comment",
	discussions[2]?.notes[0]?.system === true,
	String(discussions[2]?.notes[0]?.system),
);
check(
	"an answer that lists nothing reads as no threads",
	parseDiscussions([]).length === 0 && parseDiscussions(undefined).length === 0,
);

check(
	"a thread written against a line of the diff is a finding",
	isFinding(discussions[0] as never) && isFinding(discussions[1] as never),
);
check(
	"a thread of plain activity is not a finding",
	isFinding(discussions[2] as never) === false,
);

const finding = findingOf(discussions[0] as never, {
	project: "acme/storefront",
	iid: 12,
});

check(
	"a finding names its thread, its file and its line",
	finding?.kind === "finding" &&
		finding.finding.discussionId === discussions[0]?.id &&
		finding.finding.file === "src/uploader.ts" &&
		finding.finding.line === 42,
	JSON.stringify(finding),
);
check(
	"a finding says whether the thread is closed",
	finding?.kind === "finding" && finding.finding.resolved === false,
);

console.log("\n=== the pipeline facet ===");

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

check(
	"the newest pipeline is read with its status and ref",
	pipeline?.id === 9001 &&
		pipeline?.status === "failed" &&
		pipeline?.ref === "fix/uploader-retry",
	JSON.stringify(pipeline),
);
check(
	"an answer with no pipeline reads as none",
	parsePipeline([]) === null && parsePipeline(undefined) === null,
);

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

check(
	"a pipeline's jobs are read with their stages",
	jobs.length === 2 && jobs[0]?.name === "rspec" && jobs[0]?.stage === "test",
	JSON.stringify(jobs.map((job) => job.name)),
);
check(
	"a failed job keeps GitLab's own reason",
	jobs[0]?.status === "failed" && jobs[0]?.failureReason === "script_failure",
	String(jobs[0]?.failureReason),
);

console.log("\n=== one job ===");

const JOB = {
	id: 88,
	name: "rspec",
	stage: "test",
	status: "failed",
	failure_reason: "script_failure",
	web_url: "https://gitlab.com/acme/storefront/-/jobs/88",
};

check(
	"a job's own fields are read",
	parseJob(JOB)?.id === 88 && parseJob(JOB)?.name === "rspec",
	JSON.stringify(parseJob(JOB)),
);
check(
	"an answer that is not a job reads as none",
	parseJob({ log: "no job here" }) === undefined,
);

console.log("\n=== reading a job's trace ===");

check(
	"escape sequences are consumed rather than printed",
	readJobLog(
		"Running job\u001b[0K\r\n\u001b[31mFAILED\u001b[0m 3 examples\r\n",
	) === "Running job\nFAILED 3 examples\n",
	JSON.stringify(
		readJobLog(
			"Running job\u001b[0K\r\n\u001b[31mFAILED\u001b[0m 3 examples\r\n",
		),
	),
);
check(
	"a progress line keeps its final state",
	readJobLog("Downloading 10%\rDownloading 90%\rDone\n") === "Done\n",
	JSON.stringify(readJobLog("Downloading 10%\rDownloading 90%\rDone\n")),
);
check(
	"an operating-system command is consumed whole",
	readJobLog("\u001b]0;title\u0007text\n") === "text\n",
	JSON.stringify(readJobLog("\u001b]0;title\u0007text\n")),
);

console.log("\n=== a merge request reference ===");

check(
	"a reference is read as its project and id",
	parseReference("acme/storefront!12")?.project === "acme/storefront" &&
		parseReference("acme/storefront!12")?.iid === 12,
);
check(
	"a web URL is read as the same reference",
	parseReference("https://gitlab.com/acme/storefront/-/merge_requests/12")
		?.iid === 12,
);
check(
	"anything else is not a reference",
	parseReference("storefront") === undefined &&
		parseReference("acme/storefront#12") === undefined,
);

console.log("\n=== the comments GitLab keeps for its own editors ===");

check(
	"a description carries its prose, not the comment beside it",
	parseMergeRequestDetail(
		{ ...MR, description: "Retries the upload.\n\n<!-- link the incident -->" },
		{ project: "acme/storefront", iid: 12 },
	)?.description === "Retries the upload.",
);
check(
	"an inline comment in a note leaves the sentence it interrupted",
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
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

/**
 * The four read tools — against a channel to GitLab that answers from a script.
 *
 * The read tools exist so the agent answers its own questions about GitLab
 * through the harness's token instead of running `glab` in a shell. What
 * matters here is the contract each tool offers the model: which REST path and
 * parameters each read uses, which facets are read only when asked, how a long
 * answer is shortened, and that an empty answer is text rather than a failed
 * call. The parsers themselves are proved in `readers.test.ts`.
 *
 *   bun run test/read-tools.test.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { RuntimeState } from "dsh-integration-host";
import { GitLabAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { GitLabAuth } from "../src/host/auth";
import { resolveConfig } from "../src/host/config";
import type { TokenStore } from "../src/host/token";
import { getJobLogTool } from "../src/host/tools/get-job-log";
import { getMergeRequestTool } from "../src/host/tools/get-merge-request";
import { listMergeRequestsTool } from "../src/host/tools/list-merge-requests";
import { readTool } from "../src/host/tools/read";
import {
	GITLAB_GET_JOB_LOG_TOOL,
	GITLAB_GET_MERGE_REQUEST_TOOL,
	GITLAB_LIST_MERGE_REQUESTS_TOOL,
	GITLAB_PRESENT_TOOL,
	GITLAB_READ_TOOL,
	GITLAB_REVIEW_TOOL,
} from "../src/shared/tools";

/** One call the fake channel was asked to make. */
interface Call {
	readonly method: string;
	readonly path: string;
	readonly params: Readonly<Record<string, unknown>> | undefined;
	readonly body: unknown;
}

/** A channel to GitLab that answers from a script, and records what it was asked. */
function fakeApi(
	answers: (call: Call) => unknown,
	total?: number,
): {
	api: GitLabApi;
	calls: Call[];
} {
	const calls: Call[] = [];

	const record = (
		method: string,
		path: string,
		params?: Readonly<Record<string, unknown>>,
		body?: unknown,
	): Call => {
		const call = { method, path, params, body };
		calls.push(call);

		return call;
	};

	const api = {
		get: async (
			path: string,
			params?: Readonly<Record<string, unknown>>,
		): Promise<unknown> => answers(record("GET", path, params)),
		getAnswer: async (
			path: string,
			params?: Readonly<Record<string, unknown>>,
		): Promise<unknown> => {
			const value = answers(record("GET", path, params));

			return total === undefined ? { value } : { value, total };
		},
		getAll: async (
			path: string,
			params?: Readonly<Record<string, unknown>>,
		): Promise<{ items: unknown[]; truncated: boolean }> => {
			const answer = answers(record("GET", path, params));

			return {
				items: Array.isArray(answer) ? answer : [],
				truncated: false,
			};
		},
		post: async (path: string, body?: unknown): Promise<unknown> =>
			answers(record("POST", path, undefined, body)),
		put: async (path: string, body?: unknown): Promise<unknown> =>
			answers(record("PUT", path, undefined, body)),
		text: async (path: string): Promise<string> => {
			const answer = answers(record("GET", path));

			return typeof answer === "string" ? answer : "";
		},
	} as unknown as GitLabApi;

	return { api, calls };
}

/** A runtime state that already knows its account. */
function signedIn(): RuntimeState<GitLabAccount> {
	const state = new RuntimeState<GitLabAccount>();

	state.facts = new GitLabAccount({
		username: "ada",
		name: "Ada Lovelace",
		webUrl: "https://gitlab.com/ada",
	});

	return state;
}

/** One tool execution, as far as the tool reads it. */
function execution(): ToolRunContext {
	return {
		callId: "call-1",
		signal: new AbortController().signal,
		agent: {},
	} as unknown as ToolRunContext;
}

/** The text one render call produced. */
function textOf(definition: ToolDefinition, value: unknown): string {
	return definition.output
		.render({}, value as never)
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
}

/** The message one refused execution throws, or "" when it did not refuse. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	return "";
}

const MR = {
	iid: 12,
	title: "Add retry to the uploader",
	state: "opened",
	web_url: "https://gitlab.com/acme/storefront/-/merge_requests/12",
	source_branch: "fix/uploader-retry",
	target_branch: "main",
	author: { username: "ada" },
	reviewers: [{ username: "grace" }],
	references: { full: "acme/storefront!12" },
	user_notes_count: 7,
	detailed_merge_status: "mergeable",
	labels: ["bug", "backend"],
	pipeline: { status: "failed" },
	unresolved_discussions_count: 3,
	description: "Retries the uploader three times.\n\nKeeps the delay small.",
};

const DIFFS = [
	{
		old_path: "src/uploader.ts",
		new_path: "src/uploader.ts",
		diff: "@@ -1 +1,2 @@\n-const RETRIES = 1;\n+const RETRIES = 3;\n+const DELAY = 250;\n",
	},
];

const DISCUSSIONS = [
	{
		id: "6a9c1b2d",
		notes: [
			{
				id: 101,
				body: "This retry loop can spin forever.",
				resolvable: true,
				resolved: false,
				author: { username: "coderabbitai[bot]" },
				position: { new_path: "src/uploader.ts", new_line: 42 },
			},
			{
				id: 102,
				body: "I disagree.",
				resolvable: true,
				resolved: false,
				author: { username: "grace" },
			},
		],
	},
	{
		id: "9f8e7d6c",
		notes: [
			{
				id: 103,
				body: "Fixed the wording.",
				resolvable: true,
				resolved: true,
				author: { username: "ada" },
			},
		],
	},
];

const PIPELINES = [
	{
		id: 9001,
		status: "failed",
		ref: "fix/uploader-retry",
		source: "push",
		web_url: "https://gitlab.com/acme/storefront/-/pipelines/9001",
	},
];

const JOBS = [
	{
		id: 88,
		name: "rspec",
		stage: "test",
		status: "failed",
		failure_reason: "script_failure",
		web_url: "https://gitlab.com/acme/storefront/-/jobs/88",
	},
	{ id: 89, name: "rubocop", stage: "lint", status: "success" },
];

const JOB = {
	id: 88,
	name: "rspec",
	stage: "test",
	status: "failed",
	failure_reason: "script_failure",
	web_url: "https://gitlab.com/acme/storefront/-/jobs/88",
};

const TRACE = "Running job\n\u001b[31mFAILED\u001b[0m 3 examples\n";

/** The answer any read of one merge request's facets gets, by its own path. */
function facetAnswer(call: Call): unknown {
	if (call.path.endsWith("/diffs")) return DIFFS;
	if (call.path.endsWith("/discussions")) return DISCUSSIONS;
	if (call.path.endsWith("/pipelines")) return PIPELINES;
	if (call.path.endsWith("/jobs")) return JOBS;
	if (call.path.endsWith("/trace")) return TRACE;
	if (call.path.includes("/jobs/")) return JOB;
	if (call.path.includes("/merge_requests/")) return MR;

	return [];
}

/** What the list tool answers with. */
interface ListResult {
	readonly summary: string;
	readonly count: number;
	readonly total?: number;
	readonly items: ReadonlyArray<{
		readonly project: string;
		readonly iid: number;
		readonly title: string;
		readonly state?: string;
		readonly pipeline?: string;
		readonly unresolved?: number;
		readonly url?: string;
	}>;
}

/** What the get-merge-request tool answers with. */
interface MrResult {
	readonly summary: string;
	readonly mr: {
		readonly project: string;
		readonly iid: number;
		readonly title: string;
	};
	readonly diffs?: ReadonlyArray<{ readonly path: string }>;
	readonly discussions?: ReadonlyArray<{ readonly id: string }>;
	readonly pipeline?: {
		readonly id: number;
		readonly jobs: ReadonlyArray<{ readonly name: string }>;
	};
	readonly truncated?: boolean;
}

/** What the job-log tool answers with. */
interface JobLogResult {
	readonly summary: string;
	readonly job: { readonly name: string };
	readonly log: string;
	readonly truncated: boolean;
}

/** What the read tool answers with. */
interface ReadResult {
	readonly summary: string;
	readonly path: string;
	readonly total?: number;
	readonly truncated: boolean;
}

test("the list tool asks GitLab for what waits on the signed-in reviewer", async () => {
	{
		const { api, calls } = fakeApi(() => [MR], 137);
		const definition = listMergeRequestsTool.create({
			api,
			state: signedIn(),
		});
		const listed = (await definition.execute(
			{ scope: "review_requested" },
			execution(),
		)) as ListResult;

		expect(
			definition.name === GITLAB_LIST_MERGE_REQUESTS_TOOL,
			`the tool is registered under its shared wire name — ${definition.name}`,
		).toBe(true);
		expect(
			calls[0]?.path === "/merge_requests" &&
				calls[0]?.params?.reviewer_username === "ada" &&
				calls[0]?.params?.state === "opened" &&
				calls[0]?.params?.per_page === 10,
			`waiting for my review is a reviewer filter on open requests — ${JSON.stringify(calls[0]?.params)}`,
		).toBe(true);
		expect(
			listed.count === 1 &&
				listed.total === 137 &&
				listed.summary.startsWith(
					"Merge requests: 1 shown of 137 · review_requested",
				),
			`the heading says how many of the total are shown, and for what — ${listed.summary.split("\n")[0]}`,
		).toBe(true);
	}
});
test("a project or group list is read from its own path, keeping the filters", async () => {
	{
		const { api, calls } = fakeApi(() => [MR]);
		const definition = listMergeRequestsTool.create({
			api,
			state: signedIn(),
		});

		const scoped = (await definition.execute(
			{
				project: "acme/storefront",
				state: "merged",
				labels: "bug,backend",
				author: "grace",
				reviewer: "linus",
				limit: 5,
			},
			execution(),
		)) as ListResult;

		expect(
			calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests" &&
				calls[0]?.params?.state === "merged" &&
				calls[0]?.params?.labels === "bug,backend" &&
				calls[0]?.params?.author_username === "grace" &&
				calls[0]?.params?.reviewer_username === "linus" &&
				calls[0]?.params?.per_page === 5,
			`a project list is the project's path with the model's filters in GitLab's names — ${JSON.stringify(calls[0])}`,
		).toBe(true);
		expect(
			scoped.count === 1 && scoped.items[0]?.project === "acme/storefront",
			`the rows come back under the requested project — ${JSON.stringify(scoped.items.map((item) => item.project))}`,
		).toBe(true);

		calls.length = 0;
		await definition.execute({ group: "acme/platform" }, execution());

		expect(
			calls[0]?.path === "/groups/acme%2Fplatform/merge_requests",
			`a group list is the group's path, encoded once — ${String(calls[0]?.path)}`,
		).toBe(true);
	}
});
test("a limit above the page size is clamped to 25", async () => {
	{
		const { api, calls } = fakeApi(() => [MR]);
		const definition = listMergeRequestsTool.create({
			api,
			state: signedIn(),
		});

		await definition.execute({ limit: 500 }, execution());

		expect(
			calls[0]?.params?.per_page === 25,
			`GitLab is never asked for more than one page of 25 — ${String(calls[0]?.params?.per_page)}`,
		).toBe(true);
		expect(
			(
				definition.parameters as {
					properties?: { limit?: { maximum?: number } };
				}
			).properties?.limit?.maximum === 25,
			"and the schema does not advertise a bigger page than GitLab is asked for",
		).toBe(true);
	}
});
test("an empty list is an answer, not a failed call", async () => {
	{
		const { api, calls } = fakeApi(() => []);
		const definition = listMergeRequestsTool.create({
			api,
			state: signedIn(),
		});
		const listed = (await definition.execute(
			{ project: "acme/storefront" },
			execution(),
		)) as ListResult;

		expect(
			calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests" &&
				listed.count === 0,
			`an empty page still reads the endpoint and answers with no rows — ${String(listed.count)}`,
		).toBe(true);
		expect(
			listed.summary.startsWith("No merge requests matched."),
			`nothing matched is text the model can read — ${listed.summary}`,
		).toBe(true);
	}
});
test("a list row carries the reference, title, state, pipeline, unresolved count and URL", async () => {
	{
		const { api } = fakeApi(() => [MR], 137);
		const listed = (await listMergeRequestsTool
			.create({ api, state: signedIn() })
			.execute({}, execution())) as ListResult;
		const row = listed.items[0];

		expect(
			row !== undefined &&
				row.project === "acme/storefront" &&
				row.iid === 12 &&
				row.title === "Add retry to the uploader" &&
				row.state === "opened" &&
				row.pipeline === "failed" &&
				row.unresolved === 3 &&
				row.url === "https://gitlab.com/acme/storefront/-/merge_requests/12",
			`the row carries what the model reasons about — ${JSON.stringify(row)}`,
		).toBe(true);
		expect(
			listed.summary
				.split("\n")[1]
				?.startsWith(
					"- acme/storefront!12 · Add retry to the uploader · opened",
				) === true &&
				listed.summary.includes("pipeline: failed") &&
				listed.summary.includes("3 unresolved") &&
				listed.summary.includes(
					"https://gitlab.com/acme/storefront/-/merge_requests/12",
				),
			`and the text spells the same row out — ${listed.summary.split("\n")[1]}`,
		).toBe(true);
	}
});
test("one merge request is read first, and no facet is read unless asked", async () => {
	{
		const { api, calls } = fakeApi((call) =>
			call.path.includes("/merge_requests/") ? MR : [],
		);
		const definition = getMergeRequestTool.create({ api });
		const detail = (await definition.execute(
			{ mergeRequest: "acme/storefront!12" },
			execution(),
		)) as MrResult;

		expect(
			definition.name === GITLAB_GET_MERGE_REQUEST_TOOL,
			`the tool is registered under its shared wire name — ${definition.name}`,
		).toBe(true);
		expect(
			calls.length === 1 &&
				calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests/12",
			`the merge request's own path is the whole read — ${JSON.stringify(calls.map((call) => call.path))}`,
		).toBe(true);
		expect(
			detail.mr.iid === 12 &&
				detail.diffs === undefined &&
				detail.discussions === undefined &&
				detail.pipeline === undefined,
			`an unrequested facet is neither read nor invented in the answer — ${Object.keys(detail).join(",")}`,
		).toBe(true);
	}
});
test("each requested facet reads its own REST path", async () => {
	{
		const { api, calls } = fakeApi(facetAnswer);
		const detail = (await getMergeRequestTool.create({ api }).execute(
			{
				mergeRequest: "acme/storefront!12",
				diff: true,
				discussions: true,
				pipeline: true,
			},
			execution(),
		)) as MrResult;
		const pipeline = detail.pipeline;

		expect(
			calls.map((call) => call.path).join("\n") ===
				[
					"/projects/acme%2Fstorefront/merge_requests/12",
					"/projects/acme%2Fstorefront/merge_requests/12/diffs",
					"/projects/acme%2Fstorefront/merge_requests/12/discussions",
					"/projects/acme%2Fstorefront/merge_requests/12/pipelines",
					"/projects/acme%2Fstorefront/pipelines/9001/jobs",
				].join("\n"),
			`the merge request, then the diff, discussions, pipeline and its jobs — ${JSON.stringify(calls.map((call) => call.path))}`,
		).toBe(true);
		expect(
			calls[3]?.params?.per_page === 20,
			`only the newest twenty pipelines are asked for — ${JSON.stringify(calls[3]?.params)}`,
		).toBe(true);
		expect(
			detail.diffs?.length === 1 &&
				detail.discussions?.length === 2 &&
				pipeline !== undefined &&
				pipeline.id === 9001 &&
				pipeline.jobs.length === 2,
			`every requested facet is read out of its own answer — ${`${String(detail.diffs?.length)}/${String(detail.discussions?.length)}/${String(pipeline?.jobs.length)}`}`,
		).toBe(true);
	}
});
test("the answer text names the description, the changed file, the thread and the job", async () => {
	{
		const { api } = fakeApi(facetAnswer);
		const detail = (await getMergeRequestTool.create({ api }).execute(
			{
				mergeRequest: "acme/storefront!12",
				diff: true,
				discussions: true,
				pipeline: true,
			},
			execution(),
		)) as MrResult;

		expect(
			detail.summary.includes(
				"acme/storefront!12 · Add retry to the uploader",
			) &&
				detail.summary.includes(
					"State: opened · Author: ada · Reviewers: grace · Labels: bug, backend",
				) &&
				detail.summary.includes("Description:") &&
				detail.summary.includes("Retries the uploader three times.") &&
				detail.summary.includes("Keeps the delay small."),
			`the header and the whole description are the model's text — ${detail.summary.split("\n").slice(0, 3).join(" / ")}`,
		).toBe(true);
		expect(
			detail.summary.includes("Diff: 1 file (+2 −1)") &&
				detail.summary.includes("- src/uploader.ts (+2 −1)") &&
				detail.summary.includes("@@ -1 +1,2 @@"),
			`the diff names the changed file and carries its patch — ${detail.summary.split("\n").find((line) => line.startsWith("Diff:"))}`,
		).toBe(true);
		expect(
			detail.summary.includes("Discussions: 2 threads, 1 unresolved") &&
				detail.summary.includes(
					"[unresolved] src/uploader.ts:42 · coderabbitai[bot] · This retry loop can spin forever. (id 6a9c1b2d)",
				) &&
				detail.summary.includes("> grace: I disagree."),
			`the threads say whether they are open, where they point, and what they say — ${detail.summary.split("\n").find((line) => line.startsWith("Discussions:"))}`,
		).toBe(true);
		expect(
			detail.summary.includes(
				"Pipeline: #9001 failed (push, fix/uploader-retry)",
			) &&
				detail.summary.includes("rspec (test) failed · script_failure · id 88"),
			`the pipeline names the failed job the model should read a log for — ${detail.summary.split("\n").find((line) => line.startsWith("Pipeline:"))}`,
		).toBe(true);
	}
});
test("unresolvedOnly drops the threads that were resolved", async () => {
	{
		const { api } = fakeApi(facetAnswer);
		const definition = getMergeRequestTool.create({ api });

		const all = (await definition.execute(
			{ mergeRequest: "acme/storefront!12", discussions: true },
			execution(),
		)) as MrResult;
		const open = (await definition.execute(
			{
				mergeRequest: "acme/storefront!12",
				discussions: true,
				unresolvedOnly: true,
			},
			execution(),
		)) as MrResult;

		expect(
			all.discussions?.length === 2 &&
				all.summary.includes("Discussions: 2 threads, 1 unresolved"),
			`without the filter both threads are read and the open one is counted — ${all.summary.split("\n").find((line) => line.startsWith("Discussions:"))}`,
		).toBe(true);
		expect(
			open.discussions?.length === 1 &&
				open.summary.includes("Discussions: 1 thread, 1 unresolved") &&
				open.summary.includes("This retry loop can spin forever.") &&
				!open.summary.includes("Fixed the wording."),
			`with it, a resolved thread is not shown — ${open.summary.split("\n").find((line) => line.startsWith("Discussions:"))}`,
		).toBe(true);
	}
});
test("a merge request with no pipeline says so", async () => {
	{
		const { api } = fakeApi((call) =>
			call.path.endsWith("/pipelines") ? [] : MR,
		);
		const detail = (await getMergeRequestTool
			.create({ api })
			.execute(
				{ mergeRequest: "acme/storefront!12", pipeline: true },
				execution(),
			)) as MrResult;

		expect(
			detail.summary.includes("Pipeline: none") &&
				detail.pipeline === undefined,
			`an empty pipeline facet is said out loud, not omitted — ${detail.summary.split("\n").find((line) => line.startsWith("Pipeline:"))}`,
		).toBe(true);
	}
});
test("a value that is not a merge request reference is refused by example", async () => {
	{
		const { api, calls } = fakeApi(() => MR);
		const message = await refusalOf(() =>
			getMergeRequestTool
				.create({ api })
				.execute({ mergeRequest: "storefront" }, execution()),
		);

		expect(
			message.includes('"storefront" is not a merge request reference') &&
				message.includes("group/project!12") &&
				calls.length === 0,
			`the refusal shows the shape to use, without reading anything — ${message}`,
		).toBe(true);
	}
});
test("a merge request GitLab does not return is refused by name", async () => {
	{
		const { api } = fakeApi(() => ({}));
		const message = await refusalOf(() =>
			getMergeRequestTool
				.create({ api })
				.execute({ mergeRequest: "acme/storefront!12" }, execution()),
		);

		expect(
			message.includes(
				"GitLab returned no merge request for acme/storefront!12",
			),
			`an answer without a merge request is refused by the reference asked for — ${message}`,
		).toBe(true);
	}
});
test("a job is read, then its trace, and escapes are stripped from the text", async () => {
	{
		const { api, calls } = fakeApi((call) =>
			call.path.endsWith("/trace") ? TRACE : JOB,
		);
		const definition = getJobLogTool.create({ api });
		const log = (await definition.execute(
			{ project: "acme/storefront", jobId: 88 },
			execution(),
		)) as JobLogResult;

		expect(
			definition.name === GITLAB_GET_JOB_LOG_TOOL,
			`the tool is registered under its shared wire name — ${definition.name}`,
		).toBe(true);
		expect(
			calls[0]?.path === "/projects/acme%2Fstorefront/jobs/88" &&
				calls[1]?.path === "/projects/acme%2Fstorefront/jobs/88/trace",
			`one job is read, then its trace as text — ${JSON.stringify(calls.map((call) => call.path))}`,
		).toBe(true);
		expect(
			log.job.name === "rspec" &&
				log.truncated === false &&
				log.log === "Running job\nFAILED 3 examples",
			`the trace is text without terminal escapes — ${JSON.stringify(log.log)}`,
		).toBe(true);
		expect(
			log.summary.includes(
				"Job rspec (test) in acme/storefront: failed · script_failure",
			) &&
				log.summary.includes(
					"URL: https://gitlab.com/acme/storefront/-/jobs/88",
				) &&
				log.summary.includes("Trace:"),
			`the text names the job and what it printed — ${log.summary.split("\n")[0]}`,
		).toBe(true);
	}
});
test("a long trace keeps its end and says how much was cut", async () => {
	{
		const trace = `${"A".repeat(8_000)}${"B".repeat(32_000)}\nFAILED 3 examples`;
		const { api } = fakeApi((call) =>
			call.path.endsWith("/trace") ? trace : JOB,
		);
		const log = (await getJobLogTool
			.create({ api })
			.execute(
				{ project: "acme/storefront", jobId: 88 },
				execution(),
			)) as JobLogResult;

		expect(
			log.truncated === true &&
				log.log.length === 32_000 &&
				log.log.startsWith("B") &&
				log.log.endsWith("FAILED 3 examples"),
			`a failed job fails at the end, so the tail is what is kept — ${`${log.log.length} chars, ends ${log.log.slice(-18)}`}`,
		).toBe(true);
		expect(
			log.summary.includes("Trace (last 32000 of 40018 characters):"),
			`and the text says how much of the trace it shows — ${log.summary.split("\n").find((line) => line.startsWith("Trace"))}`,
		).toBe(true);
	}
});
test("a job id that is not a positive integer is refused", async () => {
	{
		const { api, calls } = fakeApi(() => JOB);
		const message = await refusalOf(() =>
			getJobLogTool
				.create({ api })
				.execute({ project: "acme/storefront", jobId: 0 }, execution()),
		);

		expect(
			message.includes("is not a job id") &&
				message.includes("positive integer") &&
				calls.length === 0,
			`the refusal says what a job id is, without reading anything — ${message}`,
		).toBe(true);
	}
});
test("a path's own query string is merged with the query object", async () => {
	{
		const { api, calls } = fakeApi(() => [{ id: 1 }]);
		const definition = readTool.create({ api });
		const read = (await definition.execute(
			{
				path: "/projects/acme%2Fproject/issues?state=opened&labels=bug",
				query: { per_page: 5, archived: false },
			},
			execution(),
		)) as ReadResult;

		expect(
			definition.name === GITLAB_READ_TOOL,
			`the tool is registered under its shared wire name — ${definition.name}`,
		).toBe(true);
		expect(
			calls[0]?.path === "/projects/acme%2Fproject/issues" &&
				calls[0]?.params?.state === "opened" &&
				calls[0]?.params?.labels === "bug" &&
				calls[0]?.params?.per_page === 5 &&
				calls[0]?.params?.archived === false,
			`the path is the endpoint and both query sources become its parameters — ${JSON.stringify(calls[0])}`,
		).toBe(true);
		expect(
			read.path === "/projects/acme%2Fproject/issues" &&
				read.summary.startsWith("GET /projects/acme%2Fproject/issues?"),
			`the answer names the endpoint that was actually read — ${read.summary.split("\n")[0]}`,
		).toBe(true);
	}
});
test("the total GitLab reports is part of the answer", async () => {
	{
		const { api } = fakeApi(() => [{ id: 1 }], 42);
		const read = (await readTool
			.create({ api })
			.execute(
				{ path: "/projects", query: { membership: true } },
				execution(),
			)) as ReadResult;

		expect(
			read.total === 42 &&
				read.summary.startsWith("GET /projects?membership=true — total 42"),
			`a list's total is shown beside the request — ${read.summary.split("\n")[0]}`,
		).toBe(true);
	}
});
test("a path that is not a single-slash API path is refused", async () => {
	{
		const { api, calls } = fakeApi(() => []);
		const definition = readTool.create({ api });
		const bad = [
			"projects",
			"//projects",
			"https://gitlab.com/api/v4/projects",
			"",
		];

		for (const path of bad) {
			const message = await refusalOf(() =>
				definition.execute({ path }, execution()),
			);

			expect(
				message.includes("is not a GitLab API path") &&
					message.includes('such as "/projects"'),
				`"${path}" is refused with a correct example — ${message}`,
			).toBe(true);
		}

		expect(
			calls.length === 0,
			`a refused path reads nothing — ${String(calls.length)}`,
		).toBe(true);
	}
});
test("a long JSON answer is cut and the model is told to narrow the endpoint", async () => {
	{
		const { api } = fakeApi(() => ({ projects: "x".repeat(40_000) }));
		const read = (await readTool
			.create({ api })
			.execute({ path: "/projects" }, execution())) as ReadResult;

		expect(
			read.truncated === true &&
				read.summary.length > 32_000 &&
				read.summary.includes(
					"the answer was cut at 32000 characters; ask for a narrower endpoint",
				),
			`a huge answer is cut with an instruction to ask for less — ${String(read.summary.length)} chars`,
		).toBe(true);
	}
});
test("the status document lists every tool the plugin publishes", async () => {
	{
		const auth = new GitLabAuth({
			ctx: {} as unknown as Context,
			config: resolveConfig(undefined),
			api: fakeApi(() => ({})).api,
			token: { read: async () => "token" } as unknown as TokenStore,
			state: signedIn(),
		});
		const expected = [
			GITLAB_LIST_MERGE_REQUESTS_TOOL,
			GITLAB_GET_MERGE_REQUEST_TOOL,
			GITLAB_GET_JOB_LOG_TOOL,
			GITLAB_READ_TOOL,
			GITLAB_PRESENT_TOOL,
			GITLAB_REVIEW_TOOL,
		];
		const status = await auth.getStatus();

		expect(
			status.tools.join(", ") === expected.join(", "),
			`the settings card and /gitlab status name every published tool — ${status.tools.join(", ")}`,
		).toBe(true);
	}
});
test("a state outside GitLab's list states is refused before the call", async () => {
	{
		const { api, calls } = fakeApi(() => [MR]);
		const definition = listMergeRequestsTool.create({
			api,
			state: signedIn(),
		});
		const refused = await refusalOf(() =>
			definition.execute({ state: "reviewed" }, execution()),
		);

		expect(
			refused.includes("is not a merge request state") && calls.length === 0,
			`an unknown state is answered with the states GitLab takes, without a request — ${refused}`,
		).toBe(true);
	}
});
test("every read tool renders the text its execute value carries", async () => {
	{
		const definition = listMergeRequestsTool.create({
			api: fakeApi(() => [MR], 2).api,
			state: signedIn(),
		});
		const value = (await definition.execute(
			{ scope: "review_requested" },
			execution(),
		)) as { summary: string };

		expect(
			textOf(definition, value) === value.summary,
			"the list tool's render returns the summary it answers with",
		).toBe(true);
	}
	{
		const definition = getMergeRequestTool.create({
			api: fakeApi(() => MR).api,
		});
		const value = (await definition.execute(
			{ mergeRequest: "acme/storefront!12" },
			execution(),
		)) as { summary: string };

		expect(
			textOf(definition, value) === value.summary,
			"the get-merge-request tool's render returns the summary it answers with",
		).toBe(true);
	}
	{
		const definition = getJobLogTool.create({
			api: fakeApi((call) => (call.path.endsWith("/trace") ? TRACE : JOB)).api,
		});
		const value = (await definition.execute(
			{ project: "acme/storefront", jobId: 88 },
			execution(),
		)) as { summary: string };

		expect(
			textOf(definition, value) === value.summary,
			"the job-log tool's render returns the summary it answers with",
		).toBe(true);
	}
	{
		const definition = readTool.create({
			api: fakeApi(() => ({ id: 1 })).api,
		});
		const value = (await definition.execute(
			{ path: "/projects" },
			execution(),
		)) as { summary: string };

		expect(
			textOf(definition, value) === value.summary,
			"the read tool's render returns the summary it answers with",
		).toBe(true);
	}
});

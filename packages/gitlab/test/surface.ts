/**
 * The panel, the two tools and the route — against a channel to GitLab that
 * answers from a script.
 *
 * What matters here is the contract: which REST path each operation calls, with
 * which parameters, what it does with the answer, and — for the social actions —
 * that nothing is sent until the caller confirms the exact wording. The answers
 * themselves are proved in `readers.ts`; this file proves the wiring around them.
 *
 *   bun run test/surface.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { RuntimeState } from "dsh-integration-host";
import { GitLabAccount } from "../src/host/account";
import type { GitLabApi } from "../src/host/api";
import { PanelApi } from "../src/host/panels/panel";
import { ReviewRefusal, ReviewService } from "../src/host/review";
import { createApiHandler, ROUTE_PREFIX } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import { reviewTool } from "../src/host/tools/review";
import type { GitLabStatus } from "../src/shared/status";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** One call the fake channel was asked to make. */
interface Call {
	readonly method: string;
	readonly path: string;
	readonly params: Readonly<Record<string, unknown>> | undefined;
	readonly body: unknown;
}

/** A channel to GitLab that answers from a script, and records what it was asked. */
function fakeApi(answers: (call: Call) => unknown): {
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
			const answer = answers(record("GET", path, params));

			return { value: answer, total: 2 };
		},
		getAll: async (
			path: string,
			params?: Readonly<Record<string, unknown>>,
		): Promise<{ items: unknown[]; truncated: boolean }> => {
			const answer = answers(record("GET", path, params));

			return { items: Array.isArray(answer) ? answer : [], truncated: false };
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
		individual_note: false,
		notes: [
			{
				id: 101,
				body: "This retry loop can spin forever.",
				system: false,
				resolvable: true,
				resolved: false,
				author: { username: "coderabbitai[bot]" },
				position: { new_path: "src/uploader.ts", new_line: 42 },
			},
		],
	},
	{
		id: "9f8e7d6c",
		individual_note: true,
		notes: [{ id: 104, body: "added 1 commit", system: true }],
	},
];

const PIPELINES = [
	{ id: 9001, status: "failed", ref: "fix/uploader-retry", source: "push" },
];

const JOBS = [
	{
		id: 88,
		name: "rspec",
		stage: "test",
		status: "failed",
		failure_reason: "script_failure",
	},
	{ id: 89, name: "rubocop", stage: "lint", status: "success" },
];

const JOB = {
	id: 88,
	name: "rspec",
	stage: "test",
	status: "failed",
	failure_reason: "script_failure",
};

/** The answer any of the panel's own paths gets. */
function panelAnswer(call: Call): unknown {
	if (call.path.endsWith("/diffs")) return DIFFS;
	if (call.path.endsWith("/discussions")) return DISCUSSIONS;
	if (call.path.endsWith("/pipelines")) return PIPELINES;
	if (call.path.endsWith("/jobs")) return JOBS;
	if (call.path.endsWith("/trace")) return "Running job\nFAILED 3 examples\n";
	if (call.path.includes("/jobs/")) return JOB;
	if (call.path.includes("/merge_requests/")) return MR;

	return {};
}

console.log("\n=== the panel ===");
{
	const { api, calls } = fakeApi(panelAnswer);
	const panel = new PanelApi({ api, state: signedIn() });
	const loaded = await panel.mergeRequest("acme/storefront", 12);

	check(
		"opening a merge request reads it first, with the project path encoded",
		calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests/12",
		String(calls[0]?.path),
	);
	check(
		"the diff is a second read",
		calls[1]?.path.endsWith("/diffs") === true,
		String(calls[1]?.path),
	);
	check(
		"the discussions are a third read",
		calls[2]?.path.endsWith("/discussions") === true,
		String(calls[2]?.path),
	);
	check(
		"the panel answers with the merge request, its files and its threads",
		loaded.mr.iid === 12 &&
			loaded.diffs.length === 1 &&
			loaded.discussions.length === 2,
		`${loaded.diffs.length}/${loaded.discussions.length}`,
	);
	check(
		"the panel does not read the pipeline until it is asked for",
		calls.length === 3,
		String(calls.length),
	);

	calls.length = 0;
	const pipeline = await panel.pipeline("acme/storefront", 12);

	check(
		"the pipeline is read with its jobs",
		calls[0]?.path.endsWith("/pipelines") === true &&
			calls[1]?.path === "/projects/acme%2Fstorefront/pipelines/9001/jobs",
		JSON.stringify(calls.map((call) => call.path)),
	);
	check(
		"its jobs are read out of the answer",
		pipeline.pipeline?.jobs.length === 2 &&
			pipeline.pipeline?.jobs[0]?.name === "rspec",
		String(pipeline.pipeline?.jobs.length),
	);

	calls.length = 0;
	const log = await panel.jobLog("acme/storefront", 88);

	check(
		"one job is read, then its trace as text",
		calls[0]?.path === "/projects/acme%2Fstorefront/jobs/88" &&
			calls[1]?.path === "/projects/acme%2Fstorefront/jobs/88/trace" &&
			log.log.startsWith("Running job") &&
			log.job.name === "rspec",
		JSON.stringify(calls.map((call) => call.path)),
	);
	check(
		"a trace that fits is not marked as cut",
		log.truncated === false,
		String(log.truncated),
	);

	const { api: longApi } = fakeApi((call) =>
		call.path.endsWith("/trace") ? "x".repeat(200_000) : JOB,
	);
	const long = await new PanelApi({ api: longApi, state: signedIn() }).jobLog(
		"acme/storefront",
		88,
	);

	check(
		"a long trace is cut to its end, where the failure is",
		long.truncated === true && long.log.length === 64 * 1024,
		`${long.log.length} chars`,
	);

	const { api: emptyApi } = fakeApi(() => ({}));
	let refusal = "";
	try {
		await new PanelApi({ api: emptyApi, state: signedIn() }).mergeRequest(
			"acme/storefront",
			12,
		);
	} catch (error) {
		refusal = error instanceof Error ? error.message : String(error);
	}

	check(
		"an answer with no merge request is refused by name",
		refusal.includes("acme/storefront!12"),
		refusal,
	);
}

console.log("\n=== the confirmation gate ===");
{
	const { api, calls } = fakeApi(() => ({ id: 501 }));
	const review = new ReviewService(api);
	const request = {
		project: "acme/storefront",
		iid: 12,
		action: "comment" as const,
		body: "Thanks — bounded it at three attempts.",
	};

	const pending = await review.submit(request, false);

	check(
		"an unconfirmed action sends nothing",
		pending.performed === false && calls.length === 0,
		String(calls.length),
	);
	check(
		"its draft carries the exact text that would be posted",
		pending.draft.body === request.body &&
			pending.draft.subject === "acme/storefront!12" &&
			pending.draft.action === "comment",
		JSON.stringify(pending.draft),
	);

	const sent = await review.submit(request, true);

	check(
		"a confirmed comment is posted as a note",
		calls[0]?.method === "POST" &&
			calls[0]?.path ===
				"/projects/acme%2Fstorefront/merge_requests/12/notes" &&
			(calls[0]?.body as { body?: string } | undefined)?.body === request.body,
		JSON.stringify(calls[0]),
	);
	check(
		"the answer names the note GitLab created",
		sent.performed === true && sent.result === "Note posted (id 501).",
		String(sent.result),
	);

	calls.length = 0;
	await review.submit(
		{
			project: "acme/storefront",
			iid: 12,
			action: "reply",
			body: "Fixed in the latest push.",
			discussionId: "6a9c1b2d",
		},
		true,
	);

	check(
		"a reply is posted into the thread it answers",
		calls[0]?.path ===
			"/projects/acme%2Fstorefront/merge_requests/12/discussions/6a9c1b2d/notes",
		String(calls[0]?.path),
	);

	calls.length = 0;
	await review.submit(
		{
			project: "acme/storefront",
			iid: 12,
			action: "resolve",
			discussionId: "6a9c1b2d",
		},
		true,
	);

	check(
		"resolving replaces the thread's resolved flag",
		calls[0]?.method === "PUT" &&
			calls[0]?.path ===
				"/projects/acme%2Fstorefront/merge_requests/12/discussions/6a9c1b2d" &&
			(calls[0]?.body as { resolved?: boolean } | undefined)?.resolved === true,
		JSON.stringify(calls[0]),
	);

	calls.length = 0;
	await review.submit(
		{
			project: "acme/storefront",
			iid: 12,
			action: "unresolve",
			discussionId: "d9",
		},
		true,
	);

	check(
		"reopening replaces it the other way",
		calls[0]?.method === "PUT" &&
			(calls[0]?.body as { resolved?: boolean } | undefined)?.resolved ===
				false,
		JSON.stringify(calls[0]?.body),
	);

	calls.length = 0;
	await review.submit(
		{ project: "acme/storefront", iid: 12, action: "approve" },
		true,
	);

	check(
		"approving posts to the approval path",
		calls[0]?.method === "POST" &&
			calls[0]?.path ===
				"/projects/acme%2Fstorefront/merge_requests/12/approve",
		String(calls[0]?.path),
	);

	calls.length = 0;
	await review.submit(
		{ project: "acme/storefront", iid: 12, action: "unapprove" },
		true,
	);

	check(
		"removing an approval posts to its own path",
		calls[0]?.path ===
			"/projects/acme%2Fstorefront/merge_requests/12/unapprove",
		String(calls[0]?.path),
	);

	const refusals: Array<[string, () => void]> = [
		[
			"a comment with no text is refused",
			() => review.draft({ project: "p", iid: 1, action: "comment" }),
		],
		[
			"a reply with no thread is refused",
			() => review.draft({ project: "p", iid: 1, action: "reply", body: "hi" }),
		],
		[
			"a resolve with no thread is refused",
			() => review.draft({ project: "p", iid: 1, action: "resolve" }),
		],
		[
			"a note that would run a quick action is refused",
			() =>
				review.draft({
					project: "p",
					iid: 1,
					action: "comment",
					body: "/merge",
				}),
		],
	];

	for (const [label, attempt] of refusals) {
		let thrown = "";
		try {
			attempt();
		} catch (error) {
			thrown = error instanceof ReviewRefusal ? error.message : "wrong error";
		}

		check(label, thrown !== "" && thrown !== "wrong error", thrown);
	}
}

console.log("\n=== the present tool ===");
{
	const { api, calls } = fakeApi((call) => {
		if (call.path.endsWith("/discussions")) return DISCUSSIONS;
		if (call.path.endsWith("/pipelines")) return PIPELINES;
		if (call.path.endsWith("/jobs")) return JOBS;
		if (call.path.includes("/merge_requests/")) return MR;

		return [MR];
	});
	const definition = presentTool.create({ api, state: signedIn() });

	const scoped = (await definition.execute(
		{ scope: "review_requested", title: "Ждут моего ревью" },
		execution(),
	)) as {
		shown: number;
		summary: string;
		failed: string[];
		presentation: { items: unknown[]; layout: string; total?: number };
	};

	check(
		"waiting for my review is asked for as a reviewer filter on open requests",
		calls[0]?.path === "/merge_requests" &&
			calls[0]?.params?.reviewer_username === "ada" &&
			calls[0]?.params?.state === "opened" &&
			calls[0]?.params?.per_page === 10,
		JSON.stringify(calls[0]?.params),
	);
	check(
		"the card carries the rows the list answered with, and the count behind it",
		scoped.shown === 1 &&
			scoped.presentation.items.length === 1 &&
			scoped.presentation.layout === "single" &&
			scoped.presentation.total === 2,
		`${scoped.shown}/${scoped.presentation.layout}/${String(scoped.presentation.total)}`,
	);
	check(
		"the text tells the model what the card shows",
		scoped.summary.startsWith(
			'Shown as a card titled "Ждут моего ревью": 1 item.',
		) && scoped.summary.includes("acme/storefront!12"),
		scoped.summary.split("\n")[0],
	);
	check(
		"the model's text is what the render returns",
		textOf(definition, scoped) === scoped.summary,
	);

	calls.length = 0;
	const assigned = (await definition.execute(
		{ scope: "assigned_to_me", project: "acme/storefront" },
		execution(),
	)) as { shown: number };

	check(
		"a project scope is read from the project's own path",
		calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests" &&
			calls[0]?.params?.scope === "assigned_to_me" &&
			assigned.shown === 1,
		`${calls[0]?.path} ${JSON.stringify(calls[0]?.params)}`,
	);

	calls.length = 0;
	const findings = (await definition.execute(
		{ findings: ["acme/storefront!12"] },
		execution(),
	)) as {
		shown: number;
		presentation: { items: Array<{ kind: string }>; subject?: string };
	};

	check(
		"findings read the merge request's discussions",
		calls[0]?.path.endsWith("/discussions") === true,
		String(calls[0]?.path),
	);
	check(
		"only the threads that ask for something become rows",
		findings.shown === 1 &&
			findings.presentation.items[0]?.kind === "finding" &&
			findings.presentation.subject === "acme/storefront!12",
		JSON.stringify(findings.presentation.items),
	);

	calls.length = 0;
	const jobs = (await definition.execute(
		{ jobs: ["acme/storefront!12"] },
		execution(),
	)) as { shown: number; presentation: { items: Array<{ kind: string }> } };

	check(
		"failed jobs are read from the newest pipeline",
		calls[0]?.path.endsWith("/pipelines") === true &&
			calls[1]?.path === "/projects/acme%2Fstorefront/pipelines/9001/jobs" &&
			calls[1]?.params?.scope === "failed",
		JSON.stringify(calls.map((call) => call.path)),
	);
	check(
		"every job GitLab called failed becomes a row",
		jobs.shown === 1 && jobs.presentation.items[0]?.kind === "job",
		String(jobs.shown),
	);

	calls.length = 0;
	const byReference = (await definition.execute(
		{ mergeRequests: ["acme/storefront!12"] },
		execution(),
	)) as { shown: number; failed: string[] };

	check(
		"a reference is resolved through the merge request's own path",
		calls[0]?.path === "/projects/acme%2Fstorefront/merge_requests/12" &&
			byReference.shown === 1 &&
			byReference.failed.length === 0,
		String(calls[0]?.path),
	);

	const { api: failing } = fakeApi((call) => {
		if (call.path.includes("nope%2Fmissing")) throw new Error("not found");

		return MR;
	});
	const partial = (await presentTool
		.create({ api: failing, state: signedIn() })
		.execute(
			{ mergeRequests: ["acme/storefront!12", "nope/missing!1", "junk"] },
			execution(),
		)) as { shown: number; failed: string[]; summary: string };

	check(
		"a reference that cannot be resolved is reported, not thrown",
		partial.shown === 1 && partial.failed.join(",") === "nope/missing!1,junk",
		JSON.stringify(partial.failed),
	);
	check(
		"the text says what could not be resolved",
		partial.summary.includes("Could not resolve: nope/missing!1, junk"),
		partial.summary.split("\n").at(-1),
	);

	const anonymous = presentTool.create({
		api: fakeApi(() => [MR]).api,
		state: new RuntimeState<GitLabAccount>(),
	});

	let unknown = "";
	try {
		await anonymous.execute({ scope: "review_requested" }, execution());
	} catch (error) {
		unknown = error instanceof Error ? error.message : String(error);
	}

	check(
		"a scoped list without a known account says what to run",
		unknown.includes("/gitlab sync"),
		unknown,
	);

	let nothing = "";
	try {
		await definition.execute({}, execution());
	} catch (error) {
		nothing = error instanceof Error ? error.message : String(error);
	}

	check(
		"a call with nothing to show is refused",
		nothing.includes("nothing to show"),
		nothing,
	);

	const empty = (await presentTool
		.create({ api: fakeApi(() => []).api, state: signedIn() })
		.execute({ search: "nothing matches this" }, execution())) as {
		shown: number;
		summary: string;
	};

	check(
		"an empty list is an answer, not a failed call",
		empty.shown === 0 &&
			empty.summary.includes("No merge requests, findings or jobs matched"),
		empty.summary,
	);
}

console.log("\n=== the review tool ===");
{
	const { api, calls } = fakeApi(() => ({ id: 501 }));
	const definition = reviewTool.create({ review: new ReviewService(api) });

	const pending = (await definition.execute(
		{
			mergeRequest: "acme/storefront!12",
			action: "comment",
			body: "Looks good to me.",
		},
		execution(),
	)) as { performed: boolean; summary: string };

	check(
		"an unconfirmed call performs nothing",
		pending.performed === false && calls.length === 0,
		String(calls.length),
	);
	check(
		"it answers with the exact text and the instruction to ask",
		pending.summary.includes("Not sent yet.") &&
			pending.summary.includes("Looks good to me.") &&
			pending.summary.includes("confirm: true"),
		pending.summary.split("\n")[0],
	);

	const confirmed = (await definition.execute(
		{
			mergeRequest: "acme/storefront!12",
			action: "comment",
			body: "Looks good to me.",
			confirm: true,
		},
		execution(),
	)) as { performed: boolean; summary: string };

	check(
		"a confirmed call sends it once",
		confirmed.performed === true && calls.length === 1,
		String(calls.length),
	);
	check(
		"and says what GitLab answered",
		confirmed.summary.includes("Note posted (id 501)."),
		confirmed.summary,
	);

	let bad = "";
	try {
		await definition.execute(
			{ mergeRequest: "storefront", action: "comment", body: "x" },
			execution(),
		);
	} catch (error) {
		bad = error instanceof Error ? error.message : String(error);
	}

	check(
		"a reference the tool cannot read is refused by example",
		bad.includes("group/project!12"),
		bad,
	);
}

console.log("\n=== the route ===");
{
	const { api, calls } = fakeApi(panelAnswer);
	const status: GitLabStatus = {
		signedIn: true,
		inFlight: false,
		expiresAt: null,
		scope: null,
		username: "ada",
		userName: "Ada Lovelace",
		userUrl: "https://gitlab.com/ada",
		notice: null,
		error: null,
		connected: true,
		tools: ["gitlab_present", "gitlab_review"],
		endpoint: "https://gitlab.com",
	};

	const handler = createApiHandler({
		auth: {
			getStatus: async () => status,
			signIn: async () => ({}),
			signOut: async () => {},
			connect: async () => true,
			loginMessage: () => "Paste a token.",
			settleNotice: async () => {},
			saveToken: async (token: string) => {
				calls.push({
					method: "TOKEN",
					path: token,
					params: undefined,
					body: undefined,
				});

				return status;
			},
		},
		panel: new PanelApi({ api, state: signedIn() }),
		review: new ReviewService(api),
	});

	/** One request/response pair, without a socket under it. */
	const call = async (
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; body: unknown }> => {
		const chunks =
			body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
		const request = {
			method,
			url: path,
			headers: {
				host: "127.0.0.1:52849",
				origin: "http://127.0.0.1:52849",
				"sec-fetch-site": "same-origin",
				"x-dsh-client": "1",
				"content-type": "application/json",
			},
			async *[Symbol.asyncIterator]() {
				for (const chunk of chunks) yield chunk;
			},
		} as unknown as IncomingMessage;

		let code = 0;
		let payload = "";
		const response = {
			writeHead: (value: number) => {
				code = value;

				return response;
			},
			end: (value?: string) => {
				payload = value ?? "";
			},
		} as unknown as ServerResponse;

		await handler(request, response);

		return {
			status: code,
			body: payload === "" ? undefined : JSON.parse(payload),
		};
	};

	const read = await call("GET", `${ROUTE_PREFIX}/status`);

	check(
		"the settings card reads the status",
		read.status === 200 &&
			(read.body as { username?: string }).username === "ada",
		JSON.stringify(read.body).slice(0, 80),
	);

	const saved = await call("POST", `${ROUTE_PREFIX}/token`, {
		token: "glpat-pasted",
	});

	check(
		"a pasted token is handed to the host and answered with the status",
		saved.status === 200 &&
			(saved.body as { signedIn?: boolean }).signedIn === true &&
			calls.some(
				(entry) => entry.method === "TOKEN" && entry.path === "glpat-pasted",
			),
		JSON.stringify(saved.body).slice(0, 60),
	);

	const noToken = await call("POST", `${ROUTE_PREFIX}/token`, {});

	check(
		"a token request with no token is a bad request",
		noToken.status === 400 &&
			String((noToken.body as { error?: string }).error).includes("token"),
		`${noToken.status}: ${JSON.stringify(noToken.body)}`,
	);

	const loaded = await call(
		"GET",
		`${ROUTE_PREFIX}/mr?project=acme%2Fstorefront&iid=12`,
	);

	check(
		"the panel loads a merge request by reference",
		loaded.status === 200 &&
			(loaded.body as { mr?: { iid?: number } }).mr?.iid === 12,
		JSON.stringify(loaded.body).slice(0, 80),
	);

	const pipeline = await call(
		"GET",
		`${ROUTE_PREFIX}/mr/pipeline?project=acme%2Fstorefront&iid=12`,
	);

	check(
		"the panel loads the pipeline on demand",
		pipeline.status === 200 &&
			(pipeline.body as { pipeline?: { id?: number } }).pipeline?.id === 9001,
		JSON.stringify(pipeline.body).slice(0, 80),
	);

	const job = await call(
		"GET",
		`${ROUTE_PREFIX}/mr/job?project=acme%2Fstorefront&id=88`,
	);

	check(
		"the panel loads one job's log",
		job.status === 200 &&
			String((job.body as { log?: string }).log).startsWith("Running job"),
		JSON.stringify(job.body).slice(0, 80),
	);

	calls.length = 0;
	const draft = await call("POST", `${ROUTE_PREFIX}/mr/review`, {
		project: "acme/storefront",
		iid: 12,
		action: "comment",
		body: "Looks good to me.",
	});

	check(
		"an unconfirmed write answers with the draft and sends nothing",
		draft.status === 200 &&
			(draft.body as { draft?: { body?: string } }).draft?.body ===
				"Looks good to me." &&
			calls.length === 0,
		JSON.stringify(draft.body),
	);

	calls.length = 0;
	const sent = await call("POST", `${ROUTE_PREFIX}/mr/review`, {
		project: "acme/storefront",
		iid: 12,
		action: "comment",
		body: "Looks good to me.",
		confirm: true,
	});

	check(
		"a confirmed write sends it and answers with the fresh document",
		sent.status === 200 &&
			(sent.body as { kind?: string }).kind === "merge_request" &&
			calls.some(
				(entry) => entry.method === "POST" && entry.path.endsWith("/notes"),
			),
		JSON.stringify(calls.map((entry) => entry.path)),
	);

	const badAction = await call("POST", `${ROUTE_PREFIX}/mr/review`, {
		project: "acme/storefront",
		iid: 12,
		action: "merge",
	});

	check(
		"an action this integration does not perform is a bad request",
		badAction.status === 400 &&
			String((badAction.body as { error?: string }).error).includes("merge"),
		`${badAction.status}: ${JSON.stringify(badAction.body)}`,
	);

	const noBody = await call("POST", `${ROUTE_PREFIX}/mr/review`, {
		project: "acme/storefront",
		iid: 12,
		action: "comment",
	});

	check(
		"a comment with no text is a bad request, not a gateway error",
		noBody.status === 400 &&
			String((noBody.body as { error?: string }).error).includes(
				"needs its text",
			),
		`${noBody.status}: ${JSON.stringify(noBody.body)}`,
	);

	const missing = await call("GET", `${ROUTE_PREFIX}/mr`);

	check(
		"a read without its reference is a bad request",
		missing.status === 400,
		String(missing.status),
	);

	const unknown = await call("GET", `${ROUTE_PREFIX}/nope`);

	check(
		"an unknown path is a not-found",
		unknown.status === 404,
		String(unknown.status),
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

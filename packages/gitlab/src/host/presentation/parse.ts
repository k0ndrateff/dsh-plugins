/**
 * Reading GitLab's MCP answers.
 *
 * The server answers its tools with structured JSON, but the field names are its
 * own: `web_url` beside `diffHeadSha`, `new_path` beside `pageInfo`. Every
 * reader here therefore takes a value and a list of names a field may go by, and
 * is a pure function of that value — which is what lets the recorded captures in
 * `test/readers.ts` stand in for a live account.
 *
 * A reader that cannot find its array returns nothing rather than guessing: the
 * caller then shows the merge request's own fields without that facet, which is
 * the truthful answer to "this version cannot read that part".
 */

import { stripHtmlComments } from "dsh-integration-host";
import { asRecord, pickNumber, pickString } from "dsh-mcp-oauth";
import type { MergeRequestCard, PresentationItem } from "../../shared/meta";
import type {
	DiffFile,
	Discussion,
	DiscussionNote,
	MergeRequestApprovals,
	MergeRequestDetail,
	NotePosition,
	PanelPerson,
	PipelineJob,
	PipelineSummary,
} from "../../shared/panel";

/**
 * One markdown field, without the comments GitLab stores for its own editors.
 *
 * `undefined` stays `undefined`: a caller distinguishes "the server said nothing"
 * from "the server said something empty", and stripping must not blur that.
 * @param value - the field as the server sent it.
 * @returns the field without its HTML comments.
 */
const markdownOf = (value: string | undefined): string | undefined =>
	value === undefined ? undefined : stripHtmlComments(value);

/** The records a GitLab answer may wrap its payload in. */
const WRAPPERS = [
	"data",
	"result",
	"payload",
	"merge_request",
	"mergeRequest",
	"project",
	"node",
] as const;

/** The fields a project path may go by, most specific first. */
const PROJECT_FIELDS = [
	"project_full_path",
	"projectFullPath",
	"project_path",
	"projectPath",
	"path_with_namespace",
	"pathWithNamespace",
	"full_path",
	"fullPath",
	"project",
] as const;

/** The fields a project-local id may go by. */
const IID_FIELDS = [
	"iid",
	"merge_request_iid",
	"mergeRequestIid",
	"number",
] as const;

/** `group/project!123`, as GitLab's own reference spells it. */
const REFERENCE = /^(?<project>[^!]+)!(?<iid>\d+)$/u;

/** `https://gitlab.com/group/project/-/merge_requests/123`. */
const WEB_URL =
	/^https?:\/\/[^/]+\/(?<project>.+?)\/-\/merge_requests\/(?<iid>\d+)/u;

/**
 * The JSON documents a reader walks.
 *
 * GitLab answers with the document itself — an array of diffs, one merge
 * request — so there is no envelope to unwrap; a value that is not an object is
 * simply nothing to read.
 */
function rootsOf(value: unknown): unknown[] {
	return value === null || typeof value !== "object" ? [] : [value];
}

/** The first array among the named fields of any JSON root. */
function arrayIn(
	roots: readonly unknown[],
	...names: readonly string[]
): unknown[] {
	for (const root of roots) {
		if (Array.isArray(root)) return root;

		const record = asRecord(root);
		if (record === undefined) continue;

		for (const name of names) {
			const found = record[name];
			if (Array.isArray(found)) return found;
		}

		for (const wrapper of WRAPPERS) {
			const nested = asRecord(record[wrapper]);
			if (nested === undefined) continue;

			for (const name of names) {
				const found = nested[name];
				if (Array.isArray(found)) return found;
			}
		}
	}

	return [];
}

/** The first record among the named fields of any JSON root. */
function recordIn(
	roots: readonly unknown[],
	...names: readonly string[]
): Record<string, unknown> | undefined {
	for (const root of roots) {
		const record = asRecord(root);
		if (record === undefined) continue;

		for (const name of names) {
			const nested = asRecord(record[name]);
			if (nested !== undefined) return nested;
		}

		return record;
	}

	return undefined;
}

/** The merge request one record names, however it spells it. */
function subjectOf(
	record: Record<string, unknown>,
): { project: string; iid: number } | undefined {
	const project = pickString(record, ...PROJECT_FIELDS);
	const iid = pickNumber(record, ...IID_FIELDS);

	if (project !== undefined && iid !== undefined) return { project, iid };

	const reference = pickString(record, "reference", "reference_full", "full");
	const parsed =
		reference === undefined ? undefined : REFERENCE.exec(reference);

	if (parsed?.groups !== undefined)
		return {
			project: parsed.groups.project ?? "",
			iid: Number(parsed.groups.iid),
		};

	const url = pickString(record, "web_url", "webUrl", "url");
	const fromUrl = url === undefined ? undefined : WEB_URL.exec(url);

	if (fromUrl?.groups !== undefined)
		return {
			project: fromUrl.groups.project ?? "",
			iid: Number(fromUrl.groups.iid),
		};

	const references = asRecord(record.references);
	const full =
		references === undefined ? undefined : pickString(references, "full");
	const nested = full === undefined ? undefined : REFERENCE.exec(full);

	if (nested?.groups !== undefined)
		return {
			project: nested.groups.project ?? "",
			iid: Number(nested.groups.iid),
		};

	return undefined;
}

/** One person, from whichever of the two shapes the answer uses. */
function personOf(value: unknown): PanelPerson | undefined {
	if (typeof value === "string" && value !== "") return { username: value };

	const record = asRecord(value);
	if (record === undefined) return undefined;

	const username = pickString(record, "username", "login", "name");
	if (username === undefined) return undefined;

	const name = pickString(record, "name");

	// GitLab marks an automated account on some answers and not others, so the
	// flag is kept when it is there rather than guessed from the name.
	return {
		username,
		...(name === undefined ? {} : { name }),
		...(record.bot === true ? { bot: true } : {}),
	};
}

function peopleOf(value: unknown): PanelPerson[] {
	if (!Array.isArray(value)) return [];

	const people: PanelPerson[] = [];
	for (const candidate of value) {
		const person = personOf(candidate);
		if (person !== undefined) people.push(person);
	}

	return people;
}

/** The labels an answer carries, however it spells them. */
function labelsOf(record: Record<string, unknown>): string[] {
	const raw = record.labels ?? record.label_names ?? record.labelNames;

	if (!Array.isArray(raw)) return [];

	return raw
		.map((item) => (typeof item === "string" ? item : pickString(item, "name")))
		.filter((item): item is string => item !== undefined && item !== "");
}

/** The head pipeline's status, when the merge request names one. */
function pipelineStatusOf(record: Record<string, unknown>): string | undefined {
	const direct = pickString(record, "pipeline_status", "pipelineStatus");
	if (direct !== undefined) return direct;

	const head =
		asRecord(record.head_pipeline) ??
		asRecord(record.headPipeline) ??
		asRecord(record.pipeline);

	return head === undefined ? undefined : pickString(head, "status");
}

/** One merge request row, as `list_merge_requests` answers with it. */
function mergeRequestCardOf(
	record: Record<string, unknown>,
): MergeRequestCard | undefined {
	const subject = subjectOf(record);
	const title = pickString(record, "title");

	if (subject === undefined || title === undefined) return undefined;

	const url = pickString(record, "web_url", "webUrl", "url");
	const state = pickString(record, "state");
	const author = personOf(record.author)?.username;
	const sourceBranch = pickString(record, "source_branch", "sourceBranch");
	const targetBranch = pickString(record, "target_branch", "targetBranch");
	const updatedAt = pickString(record, "updated_at", "updatedAt");
	const notes = pickNumber(record, "user_notes_count", "userNotesCount");
	const unresolved = pickNumber(
		record,
		"unresolved_discussions_count",
		"unresolvedDiscussionsCount",
	);
	const pipeline = pipelineStatusOf(record);
	const reviewers = peopleOf(record.reviewers).map((person) => person.username);
	const draft =
		record.draft === true ||
		record.work_in_progress === true ||
		title.startsWith("Draft:") ||
		title.startsWith("WIP:");

	return {
		project: subject.project,
		iid: subject.iid,
		title,
		draft,
		...(url === undefined ? {} : { url }),
		...(state === undefined ? {} : { state }),
		...(author === undefined ? {} : { author }),
		...(reviewers.length === 0 ? {} : { reviewers }),
		...(sourceBranch === undefined ? {} : { sourceBranch }),
		...(targetBranch === undefined ? {} : { targetBranch }),
		...(pipeline === undefined ? {} : { pipeline }),
		...(updatedAt === undefined ? {} : { updatedAt }),
		...(notes === undefined ? {} : { notes }),
		...(unresolved === undefined ? {} : { unresolved }),
	};
}

/**
 * Read a merge request list.
 * @param value - the result of `list_merge_requests` or `search`.
 * @returns the rows it lists, and the total it claims when it claims one.
 */
export function parseMergeRequestList(value: unknown): {
	items: readonly MergeRequestCard[];
	total?: number;
} {
	const roots = rootsOf(value);
	const records = arrayIn(
		roots,
		"merge_requests",
		"mergeRequests",
		"items",
		"nodes",
	);

	const items: MergeRequestCard[] = [];
	for (const candidate of records) {
		const record = asRecord(candidate);
		if (record === undefined) continue;

		const card = mergeRequestCardOf(record);
		if (card !== undefined) items.push(card);
	}

	const page = recordIn(
		roots,
		"page_info",
		"pageInfo",
		"metadata",
		"pagination",
	);
	const total =
		page === undefined ? undefined : pickNumber(page, "total", "total_count");

	return { items, ...(total === undefined ? {} : { total }) };
}

/** One merge request row, from whatever the answer calls the payload. */
export function parseMergeRequestCard(
	value: unknown,
): MergeRequestCard | undefined {
	const roots = rootsOf(value);
	const record = recordIn(roots, "merge_request", "mergeRequest", "node");

	return record === undefined ? undefined : mergeRequestCardOf(record);
}

/**
 * Read one merge request's own fields.
 * @param value - the result of `get_merge_request` without a facet.
 * @param fallback - the project and iid the caller asked for, used when the
 *   answer leaves them implicit.
 */
export function parseMergeRequestDetail(
	value: unknown,
	fallback: { project: string; iid: number },
): MergeRequestDetail | undefined {
	const roots = rootsOf(value);
	const record = recordIn(roots, "merge_request", "mergeRequest", "node");

	if (record === undefined) return undefined;

	const title = pickString(record, "title");
	if (title === undefined) return undefined;

	const subject = subjectOf(record) ?? fallback;
	const url = pickString(record, "web_url", "webUrl", "url");
	const state = pickString(record, "state");
	const author = personOf(record.author);
	const sourceBranch = pickString(record, "source_branch", "sourceBranch");
	const targetBranch = pickString(record, "target_branch", "targetBranch");
	const createdAt = pickString(record, "created_at", "createdAt");
	const updatedAt = pickString(record, "updated_at", "updatedAt");
	// The detailed status is the newer and more specific one — `mergeable` rather
	// than `can_be_merged` — so it is preferred where both are present.
	const mergeStatus = pickString(
		record,
		"detailed_merge_status",
		"detailedMergeStatus",
		"merge_status",
		"mergeStatus",
	);
	const userNotesCount = pickNumber(
		record,
		"user_notes_count",
		"userNotesCount",
	);
	const diffHeadSha = pickString(record, "diff_head_sha", "diffHeadSha", "sha");
	const description = markdownOf(pickString(record, "description"));

	return {
		project: subject.project,
		iid: subject.iid,
		title,
		draft: record.draft === true || record.work_in_progress === true,
		hasConflicts: record.has_conflicts === true || record.hasConflicts === true,
		assignees: peopleOf(record.assignees),
		reviewers: peopleOf(record.reviewers),
		labels: labelsOf(record),
		...(url === undefined ? {} : { url }),
		...(state === undefined ? {} : { state }),
		...(author === undefined ? {} : { author }),
		...(sourceBranch === undefined ? {} : { sourceBranch }),
		...(targetBranch === undefined ? {} : { targetBranch }),
		...(createdAt === undefined ? {} : { createdAt }),
		...(updatedAt === undefined ? {} : { updatedAt }),
		...(mergeStatus === undefined ? {} : { mergeStatus }),
		...(userNotesCount === undefined ? {} : { userNotesCount }),
		...(diffHeadSha === undefined ? {} : { diffHeadSha }),
		...(description === undefined ? {} : { description }),
	};
}

/**
 * Count one patch's added and removed lines.
 *
 * The diffs endpoint sends the patch text without statistics — the counts live
 * on the merge request as a whole — so the numbers a file's header shows are
 * counted here rather than asked for twice.
 */
function countLines(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	let started = false;

	for (const line of patch.split(/\r?\n/u)) {
		if (line.startsWith("@@")) {
			started = true;

			continue;
		}

		// A file header is metadata only before the first hunk. After it, a
		// removed line `--- old` is content, not the `--- a/file` header.
		if (
			!started &&
			(line.startsWith("--- ") ||
				line.startsWith("+++ ") ||
				line.startsWith("diff --git") ||
				line.startsWith("index "))
		)
			continue;

		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}

	return { added, removed };
}

/** One changed file, from the diff facet's own field names. */
function diffFileOf(record: Record<string, unknown>): DiffFile | undefined {
	const path =
		pickString(record, "new_path", "newPath", "path", "file_path") ??
		pickString(record, "old_path", "oldPath");

	if (path === undefined) return undefined;

	const oldPath = pickString(record, "old_path", "oldPath");
	const patch = pickString(record, "diff", "patch", "full_patch", "fullPatch");
	const counted = patch === undefined ? undefined : countLines(patch);

	return {
		path,
		newFile: record.new_file === true || record.newFile === true,
		deletedFile: record.deleted_file === true || record.deletedFile === true,
		renamedFile: record.renamed_file === true || record.renamedFile === true,
		added:
			pickNumber(record, "additions", "added", "added_lines") ??
			counted?.added ??
			0,
		removed:
			pickNumber(record, "deletions", "removed", "removed_lines") ??
			counted?.removed ??
			0,
		...(oldPath === undefined ? {} : { oldPath }),
		...(patch === undefined ? {} : { patch }),
	};
}

/**
 * Read a merge request's diff.
 * @param value - the result of `get_merge_request` with `include: ["diffs"]`.
 * @returns one entry per changed file, in the order the server listed them.
 */
export function parseDiffFiles(value: unknown): readonly DiffFile[] {
	const records = arrayIn(
		rootsOf(value),
		"diffs",
		"files",
		"changes",
		"diff_files",
	);

	const files: DiffFile[] = [];
	for (const candidate of records) {
		const record = asRecord(candidate);
		if (record === undefined) continue;

		const file = diffFileOf(record);
		if (file !== undefined) files.push(file);
	}

	return files;
}

/** Where in a diff one note was written. */
function positionOf(record: Record<string, unknown>): NotePosition | undefined {
	const position =
		asRecord(record.position) ??
		asRecord(record.diff_position) ??
		asRecord(record.diffPosition);

	if (position === undefined) return undefined;

	const file = pickString(position, "new_path", "newPath", "path", "file_path");
	const oldLine = pickNumber(position, "old_line", "oldLine");
	const newLine = pickNumber(position, "new_line", "newLine");

	if (file === undefined && oldLine === undefined && newLine === undefined)
		return undefined;

	return {
		...(file === undefined ? {} : { file }),
		...(oldLine === undefined ? {} : { oldLine }),
		...(newLine === undefined ? {} : { newLine }),
	};
}

/** The thread one note belongs to, as the note itself spells it. */
function threadOf(
	record: Record<string, unknown>,
): { id: string; resolved: boolean; resolvable: boolean } | undefined {
	const discussion =
		asRecord(record.discussion) ?? asRecord(record.discussion_thread);

	const id =
		pickString(record, "discussion_id", "discussionId") ??
		(discussion === undefined
			? undefined
			: pickString(discussion, "id", "discussion_id"));

	if (id === undefined) return undefined;

	return {
		id,
		resolved: record.resolved === true || discussion?.resolved === true,
		resolvable: discussion?.resolvable !== false && record.resolvable !== false,
	};
}

/** One note of a thread. */
function noteOf(record: Record<string, unknown>): DiscussionNote | undefined {
	const body = markdownOf(pickString(record, "body", "note", "text"));
	if (body === undefined) return undefined;

	const id = pickString(record, "id", "note_id");
	const author = personOf(record.author);
	const createdAt = pickString(record, "created_at", "createdAt");
	const position = positionOf(record);

	return {
		body,
		system: record.system === true,
		internal: record.internal === true || record.confidential === true,
		...(id === undefined ? {} : { id }),
		...(author === undefined ? {} : { author }),
		...(createdAt === undefined ? {} : { createdAt }),
		...(position === undefined ? {} : { position }),
	};
}

/**
 * Read a merge request's discussions.
 *
 * The notes facet answers with flat notes that each name their thread, so they
 * are grouped here; an answer that already nests its threads is read as it is.
 * A thread's `resolved` flag is whichever of its notes or its own record says
 * so, because a note-level answer carries it per note.
 */
export function parseDiscussions(value: unknown): readonly Discussion[] {
	const roots = rootsOf(value);
	const threads = arrayIn(roots, "discussions", "discussion_threads");
	const threadsById = new Map<string, Discussion>();
	const order: string[] = [];

	const upsert = (
		id: string,
		patch: {
			resolved?: boolean;
			resolvable?: boolean;
			note?: DiscussionNote;
		},
	): void => {
		const existing = threadsById.get(id);

		if (existing === undefined) {
			order.push(id);
			threadsById.set(id, {
				id,
				resolved: patch.resolved === true,
				resolvable: patch.resolvable !== false,
				notes: patch.note === undefined ? [] : [patch.note],
			});

			return;
		}

		threadsById.set(id, {
			...existing,
			resolved: existing.resolved || patch.resolved === true,
			resolvable: existing.resolvable && patch.resolvable !== false,
			notes:
				patch.note === undefined
					? existing.notes
					: [...existing.notes, patch.note],
		});
	};

	if (threads.length > 0) {
		for (const candidate of threads) {
			const record = asRecord(candidate);
			if (record === undefined) continue;

			const id = pickString(record, "id", "discussion_id");
			if (id === undefined) continue;

			const notes = Array.isArray(record.notes) ? record.notes : [];
			const parsed: DiscussionNote[] = [];
			let resolvable = 0;
			let unresolved = 0;

			for (const note of notes) {
				const record2 = asRecord(note);
				if (record2 === undefined) continue;

				if (record2.resolvable === true) {
					resolvable += 1;
					if (record2.resolved !== true) unresolved += 1;
				}

				const read = noteOf(record2);
				if (read !== undefined) parsed.push(read);
			}

			// A discussion is resolved when every note that can be resolved is; a
			// thread of plain comments is not resolvable at all.
			const resolved =
				resolvable > 0 ? unresolved === 0 : record.resolved === true;

			upsert(id, {
				resolved,
				resolvable: resolvable > 0 || record.resolvable === true,
			});
			for (const note of parsed) upsert(id, { resolved, note });
		}

		return order.map((id) => threadsById.get(id) as Discussion);
	}

	const notes = arrayIn(roots, "notes", "items");
	for (const candidate of notes) {
		const record = asRecord(candidate);
		if (record === undefined) continue;

		const thread = threadOf(record);
		const note = noteOf(record);

		if (thread === undefined || note === undefined) continue;

		upsert(thread.id, {
			resolved: thread.resolved,
			resolvable: thread.resolvable,
			note,
		});
	}

	return order.map((id) => threadsById.get(id) as Discussion);
}

/** One pipeline, as the pipelines facet answers with it. */
function pipelineOf(
	record: Record<string, unknown>,
): PipelineSummary | undefined {
	const id = pickNumber(record, "id", "pipeline_id");
	const status = pickString(record, "status", "state");

	if (id === undefined || status === undefined) return undefined;

	const url = pickString(record, "web_url", "webUrl", "url");
	const source = pickString(record, "source");
	const ref = pickString(record, "ref");

	return {
		id,
		status,
		jobs: parseJobs(record.jobs),
		...(url === undefined ? {} : { url }),
		...(source === undefined ? {} : { source }),
		...(ref === undefined ? {} : { ref }),
	};
}

/** One job, from whichever field names the answer uses. */
function jobOf(record: Record<string, unknown>): PipelineJob | undefined {
	const id = pickNumber(record, "id", "job_id");
	const name = pickString(record, "name", "job_name");
	const status = pickString(record, "status", "state");

	if (id === undefined || name === undefined || status === undefined)
		return undefined;

	const stage = pickString(record, "stage");
	const failureReason = pickString(
		record,
		"failure_reason",
		"failureReason",
		"failure_message",
	);
	const url = pickString(record, "web_url", "webUrl", "url");

	return {
		id,
		name,
		status,
		allowFailure: record.allow_failure === true || record.allowFailure === true,
		...(stage === undefined ? {} : { stage }),
		...(failureReason === undefined ? {} : { failureReason }),
		...(url === undefined ? {} : { url }),
	};
}

/**
 * Read one job's own fields.
 * @param value - the result of `get_job`, with or without a facet.
 */
export function parseJob(value: unknown): PipelineJob | undefined {
	const record = recordIn(rootsOf(value), "job", "node");

	return record === undefined ? undefined : jobOf(record);
}

/**
 * Read a pipeline's jobs.
 * @param value - the `jobs` facet of `get_pipeline`, or a whole pipeline record.
 */
export function parseJobs(value: unknown): readonly PipelineJob[] {
	const records = Array.isArray(value)
		? value
		: arrayIn(rootsOf(value), "jobs", "items");

	const jobs: PipelineJob[] = [];
	for (const candidate of records) {
		const record = asRecord(candidate);
		if (record === undefined) continue;

		const job = jobOf(record);
		if (job !== undefined) jobs.push(job);
	}

	return jobs;
}

/**
 * Read a merge request's head pipeline.
 * @param value - the result of `get_merge_request` with `include: ["pipelines"]`.
 * @returns the newest pipeline it lists, or null when it lists none.
 */
export function parsePipeline(value: unknown): PipelineSummary | null {
	const roots = rootsOf(value);
	const records = arrayIn(roots, "pipelines", "items");

	for (const candidate of records) {
		const record = asRecord(candidate);
		if (record === undefined) continue;

		const pipeline = pipelineOf(record);
		if (pipeline !== undefined) return pipeline;
	}

	const single = recordIn(roots, "pipeline", "head_pipeline", "headPipeline");

	return single === undefined ? null : (pipelineOf(single) ?? null);
}

/**
 * Read one merge request reference.
 *
 * A card row, a note, and the agent all name a merge request the way GitLab
 * does — `group/project!123` — or by its URL, and both spellings resolve here so
 * the tools accept whichever the caller has.
 *
 * @param value - a reference or a web URL.
 * @returns the project path and the project-local id, or undefined.
 */
export function parseReference(
	value: string,
): { project: string; iid: number } | undefined {
	const trimmed = value.trim();

	const reference = REFERENCE.exec(trimmed);
	if (reference?.groups !== undefined)
		return {
			project: reference.groups.project ?? "",
			iid: Number(reference.groups.iid),
		};

	const url = WEB_URL.exec(trimmed);
	if (url?.groups !== undefined)
		return { project: url.groups.project ?? "", iid: Number(url.groups.iid) };

	return undefined;
}

/** One finding, as a card row shows it: the first note of a thread. */
export function findingOf(
	discussion: Discussion,
	subject: { project: string; iid: number },
): PresentationItem | undefined {
	const note = discussion.notes.find((candidate) => !candidate.system);
	if (note === undefined) return undefined;

	const position = note.position;
	const line = position?.newLine ?? position?.oldLine;
	const lineSide =
		position?.newLine !== undefined
			? ("new" as const)
			: position?.oldLine !== undefined
				? ("old" as const)
				: undefined;

	return {
		kind: "finding",
		finding: {
			project: subject.project,
			iid: subject.iid,
			discussionId: discussion.id,
			resolved: discussion.resolved,
			body: note.body,
			...(note.author === undefined ? {} : { author: note.author.username }),
			...(position?.file === undefined ? {} : { file: position.file }),
			...(line === undefined ? {} : { line }),
			...(lineSide === undefined ? {} : { lineSide }),
		},
	};
}

/** One person GitLab lists as an approver; the nested `user` is the person. */
function approverOf(value: unknown): PanelPerson | undefined {
	const record = asRecord(value);
	if (record === undefined) return personOf(value);

	return personOf(record.user) ?? personOf(record);
}

/**
 * Read the approvals of one merge request out of `/approvals`.
 *
 * GitLab answers with everyone who approved, how many approvals the project
 * requires, and how many are still missing; whether the reader's own approval is
 * among them is what decides which of the two approval actions the panel offers,
 * so it is answered here rather than left to the browser half to guess.
 * @param value - the endpoint's answer.
 * @param viewer - the signed-in user's username, when the account is known.
 * @returns the approvals, or undefined when the answer is not one.
 */
export function parseApprovals(
	value: unknown,
	viewer: string | undefined,
): MergeRequestApprovals | undefined {
	const record = asRecord(value);
	if (record === undefined) return undefined;

	const approvedBy: PanelPerson[] = [];
	const listed = Array.isArray(record.approved_by)
		? record.approved_by
		: Array.isArray(record.approvedBy)
			? record.approvedBy
			: [];

	for (const candidate of listed) {
		const person = approverOf(candidate);
		if (person !== undefined) approvedBy.push(person);
	}

	const required = pickNumber(
		record,
		"approvals_required",
		"approvalsRequired",
	);
	const left = pickNumber(record, "approvals_left", "approvalsLeft");

	return {
		approvedByViewer:
			viewer !== undefined &&
			approvedBy.some((person) => person.username === viewer),
		approved: record.approved === true,
		approvedBy,
		...(required === undefined ? {} : { required }),
		...(left === undefined ? {} : { left }),
	};
}

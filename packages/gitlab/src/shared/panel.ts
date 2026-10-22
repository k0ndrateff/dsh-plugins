/**
 * What the side panel shows, as the two halves agree on it.
 *
 * The host half resolves a merge request through the MCP connection — its own
 * fields, then the diff, discussion and pipeline facets — and answers the
 * browser half with one of these documents over `/dsh-gitlab`. The panel renders
 * exactly what it is given; both halves import these types, and the browser half
 * validates before trusting them, because the two halves can be a version apart
 * while a plugin is being developed.
 */

/** The sections of the merge request panel, as its tabs name them. */
export const PANEL_TABS = [
	"overview",
	"diff",
	"discussions",
	"pipeline",
] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

/** What a panel is opened on. */
export interface PanelTarget {
	/** Full path of the project, such as `group/project`. */
	readonly project: string;
	/** Project-local merge request id. */
	readonly iid: number;
	/** The section to open on; the overview unless a card asked for another. */
	readonly tab?: PanelTab;
}

/** Whether one string names a section of the panel. */
export function isPanelTab(value: unknown): value is PanelTab {
	return (
		typeof value === "string" &&
		(PANEL_TABS as readonly string[]).includes(value)
	);
}

/** A person, as GitLab identifies them. */
export interface PanelPerson {
	readonly username: string;
	readonly name?: string;
	/** GitLab's own flag, sent with some answers and not others. */
	readonly bot?: boolean;
}

/** Where in a diff a note was written. */
export interface NotePosition {
	readonly file?: string;
	readonly oldLine?: number;
	readonly newLine?: number;
}

/** One note of a discussion thread. */
export interface DiscussionNote {
	readonly id?: string;
	readonly author?: PanelPerson;
	/** Markdown, as GitLab returned it. */
	readonly body: string;
	readonly createdAt?: string;
	/** True for GitLab's own activity notes, which are not review comments. */
	readonly system: boolean;
	readonly internal: boolean;
	readonly position?: NotePosition;
}

/** One discussion thread, resolvable or not. */
export interface Discussion {
	/** The id every review action names. */
	readonly id: string;
	readonly resolved: boolean;
	/** False for a plain note that cannot be resolved. */
	readonly resolvable: boolean;
	readonly notes: readonly DiscussionNote[];
}

/** One file of a merge request's diff. */
export interface DiffFile {
	/** The path after the change; what a diff comment names. */
	readonly path: string;
	readonly oldPath?: string;
	readonly newFile: boolean;
	readonly deletedFile: boolean;
	readonly renamedFile: boolean;
	readonly added: number;
	readonly removed: number;
	/** The patch text, when the answer carried it rather than statistics. */
	readonly patch?: string;
}

/** The merge request's own fields. */
export interface MergeRequestDetail {
	readonly project: string;
	readonly iid: number;
	readonly title: string;
	readonly url?: string;
	/** `opened`, `merged`, `closed`, as GitLab words it. */
	readonly state?: string;
	readonly draft: boolean;
	readonly author?: PanelPerson;
	readonly assignees: readonly PanelPerson[];
	readonly reviewers: readonly PanelPerson[];
	readonly labels: readonly string[];
	readonly sourceBranch?: string;
	readonly targetBranch?: string;
	readonly createdAt?: string;
	readonly updatedAt?: string;
	/** GitLab's own mergeability words, such as `mergeable`. */
	readonly mergeStatus?: string;
	readonly hasConflicts: boolean;
	readonly userNotesCount?: number;
	/** The head commit the approvals and diff comments refer to. */
	readonly diffHeadSha?: string;
	/** Markdown, as GitLab returned it, bounded. */
	readonly description?: string;
}

/** One job of a pipeline. */
export interface PipelineJob {
	readonly id: number;
	readonly name: string;
	readonly stage?: string;
	readonly status: string;
	/** GitLab's own reason, such as `script_failure`. */
	readonly failureReason?: string;
	readonly url?: string;
	readonly allowFailure: boolean;
}

/** The merge request's head pipeline, when it has one. */
export interface PipelineSummary {
	readonly id: number;
	readonly status: string;
	readonly url?: string;
	readonly source?: string;
	readonly ref?: string;
	readonly jobs: readonly PipelineJob[];
}

/** Everything the panel shows for one merge request. */
export interface MergeRequestPanel {
	readonly kind: "merge_request";
	readonly mr: MergeRequestDetail;
	readonly diffs: readonly DiffFile[];
	readonly discussions: readonly Discussion[];
	/** Whether GitLab had more diff or discussion pages than the panel read. */
	readonly truncated?: boolean;
}

/** The head pipeline and its jobs, read when the Pipeline tab is opened. */
export interface PipelinePanel {
	readonly kind: "pipeline";
	readonly project: string;
	readonly iid: number;
	readonly pipeline: PipelineSummary | null;
}

/** One job's log, read on demand. */
export interface JobLogPanel {
	readonly kind: "job_log";
	readonly project: string;
	readonly job: PipelineJob;
	/** The trace, with its escape sequences still in it. */
	readonly log: string;
	/** Whether the server held back the rest of a longer log. */
	readonly truncated: boolean;
}

/** The review actions this integration performs, and nothing else. */
export const REVIEW_ACTIONS = [
	"comment",
	"reply",
	"resolve",
	"unresolve",
	"approve",
	"unapprove",
] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** What one review action asks for. */
export interface ReviewRequest {
	readonly project: string;
	readonly iid: number;
	readonly action: ReviewAction;
	/** The note's text; required by `comment` and `reply`. */
	readonly body?: string;
	/** The thread; required by `reply`, `resolve`, and `unresolve`. */
	readonly discussionId?: string;
}

/**
 * One social action, before it is sent.
 *
 * A write that changes somebody else's merge request — a comment, a reply, a
 * resolved thread, an approval — is shown to the user in these words first, and
 * only then sent with `confirm`.
 */
export interface ReviewDraft {
	readonly action: ReviewAction;
	/** One line naming what will happen. */
	readonly summary: string;
	/** The note's text exactly as it will be posted, when there is one. */
	readonly body?: string;
	/** The merge request it will be posted to, as `group/project!12`. */
	readonly subject: string;
	/** The thread it will touch, when the action names one. */
	readonly discussionId?: string;
}

/**
 * Whether one thread is a review finding rather than a conversation.
 *
 * A finding is a note written against a line of the diff — what a reviewer or a
 * review bot leaves behind, and what the "go through the review comments"
 * workflow works from. A thread of plain notes is not one, however many people
 * wrote in it.
 */
export function isFinding(discussion: Discussion): boolean {
	return discussion.notes.some(
		(note) => !note.system && note.position !== undefined,
	);
}

/** Whether one string is an action this integration performs. */
export function isReviewAction(value: unknown): value is ReviewAction {
	return (
		typeof value === "string" &&
		(REVIEW_ACTIONS as readonly string[]).includes(value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asPerson(value: unknown): PanelPerson | undefined {
	if (!isRecord(value)) return undefined;

	const username = asString(value.username);
	if (username === undefined) return undefined;

	const name = asString(value.name);

	return {
		username,
		...(name === undefined ? {} : { name }),
		...(value.bot === true ? { bot: true } : {}),
	};
}

function asPeople(value: unknown): PanelPerson[] {
	if (!Array.isArray(value)) return [];

	const people: PanelPerson[] = [];
	for (const candidate of value) {
		const person = asPerson(candidate);
		if (person !== undefined) people.push(person);
	}

	return people;
}

function asPosition(value: unknown): NotePosition | undefined {
	if (!isRecord(value)) return undefined;

	const file = asString(value.file);
	const oldLine = asNumber(value.oldLine);
	const newLine = asNumber(value.newLine);

	if (file === undefined && oldLine === undefined && newLine === undefined)
		return undefined;

	return {
		...(file === undefined ? {} : { file }),
		...(oldLine === undefined ? {} : { oldLine }),
		...(newLine === undefined ? {} : { newLine }),
	};
}

function asNote(value: unknown): DiscussionNote | undefined {
	if (!isRecord(value)) return undefined;

	const body = asString(value.body);
	if (body === undefined) return undefined;

	const id = asString(value.id);
	const author = asPerson(value.author);
	const createdAt = asString(value.createdAt);
	const position = asPosition(value.position);

	return {
		body,
		system: value.system === true,
		internal: value.internal === true,
		...(id === undefined ? {} : { id }),
		...(author === undefined ? {} : { author }),
		...(createdAt === undefined ? {} : { createdAt }),
		...(position === undefined ? {} : { position }),
	};
}

function asDiscussion(value: unknown): Discussion | undefined {
	if (!isRecord(value)) return undefined;

	const id = asString(value.id);
	if (id === undefined) return undefined;

	const notes: DiscussionNote[] = [];
	if (Array.isArray(value.notes)) {
		for (const candidate of value.notes) {
			const note = asNote(candidate);
			if (note !== undefined) notes.push(note);
		}
	}

	return {
		id,
		resolved: value.resolved === true,
		resolvable: value.resolvable !== false,
		notes,
	};
}

function asDiffFile(value: unknown): DiffFile | undefined {
	if (!isRecord(value)) return undefined;

	const path = asString(value.path);
	if (path === undefined) return undefined;

	const oldPath = asString(value.oldPath);
	const patch = asString(value.patch);

	return {
		path,
		newFile: value.newFile === true,
		deletedFile: value.deletedFile === true,
		renamedFile: value.renamedFile === true,
		added: asNumber(value.added) ?? 0,
		removed: asNumber(value.removed) ?? 0,
		...(oldPath === undefined ? {} : { oldPath }),
		...(patch === undefined ? {} : { patch }),
	};
}

function asJob(value: unknown): PipelineJob | undefined {
	if (!isRecord(value)) return undefined;

	const id = asNumber(value.id);
	const name = asString(value.name);
	const status = asString(value.status);

	if (id === undefined || name === undefined || status === undefined)
		return undefined;

	const stage = asString(value.stage);
	const failureReason = asString(value.failureReason);
	const url = asString(value.url);

	return {
		id,
		name,
		status,
		allowFailure: value.allowFailure === true,
		...(stage === undefined ? {} : { stage }),
		...(failureReason === undefined ? {} : { failureReason }),
		...(url === undefined ? {} : { url }),
	};
}

function asPipeline(value: unknown): PipelineSummary | null {
	if (!isRecord(value)) return null;

	const id = asNumber(value.id);
	const status = asString(value.status);

	if (id === undefined || status === undefined) return null;

	const jobs: PipelineJob[] = [];
	if (Array.isArray(value.jobs)) {
		for (const candidate of value.jobs) {
			const job = asJob(candidate);
			if (job !== undefined) jobs.push(job);
		}
	}

	const url = asString(value.url);
	const source = asString(value.source);
	const ref = asString(value.ref);

	return {
		id,
		status,
		jobs,
		...(url === undefined ? {} : { url }),
		...(source === undefined ? {} : { source }),
		...(ref === undefined ? {} : { ref }),
	};
}

function asMergeRequestDetail(value: unknown): MergeRequestDetail | undefined {
	if (!isRecord(value)) return undefined;

	const project = asString(value.project);
	const iid = asNumber(value.iid);
	const title = asString(value.title);

	if (project === undefined || iid === undefined || title === undefined)
		return undefined;

	const url = asString(value.url);
	const state = asString(value.state);
	const author = asPerson(value.author);
	const sourceBranch = asString(value.sourceBranch);
	const targetBranch = asString(value.targetBranch);
	const createdAt = asString(value.createdAt);
	const updatedAt = asString(value.updatedAt);
	const mergeStatus = asString(value.mergeStatus);
	const userNotesCount = asNumber(value.userNotesCount);
	const diffHeadSha = asString(value.diffHeadSha);
	const description = asString(value.description);
	const labels = Array.isArray(value.labels)
		? value.labels.filter((item): item is string => typeof item === "string")
		: [];

	return {
		project,
		iid,
		title,
		draft: value.draft === true,
		hasConflicts: value.hasConflicts === true,
		assignees: asPeople(value.assignees),
		reviewers: asPeople(value.reviewers),
		labels,
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
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without one.
 */
export function asPanelTarget(value: unknown): PanelTarget | undefined {
	if (!isRecord(value)) return undefined;

	const project = asString(value.project);
	const iid = asNumber(value.iid);

	if (project === undefined || iid === undefined) return undefined;

	return {
		project,
		iid,
		...(isPanelTab(value.tab) ? { tab: value.tab } : {}),
	};
}

/**
 * Narrow one response body to a merge request document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export function asMergeRequestPanel(
	value: unknown,
): MergeRequestPanel | undefined {
	if (!isRecord(value) || value.kind !== "merge_request") return undefined;

	const mr = asMergeRequestDetail(value.mr);
	if (mr === undefined) return undefined;

	const diffs: DiffFile[] = [];
	if (Array.isArray(value.diffs)) {
		for (const candidate of value.diffs) {
			const file = asDiffFile(candidate);
			if (file !== undefined) diffs.push(file);
		}
	}

	const discussions: Discussion[] = [];
	if (Array.isArray(value.discussions)) {
		for (const candidate of value.discussions) {
			const discussion = asDiscussion(candidate);
			if (discussion !== undefined) discussions.push(discussion);
		}
	}

	return {
		kind: "merge_request",
		mr,
		diffs,
		discussions,
		...(value.truncated === true ? { truncated: true } : {}),
	};
}

/**
 * Narrow one response body to a pipeline document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export function asPipelinePanel(value: unknown): PipelinePanel | undefined {
	if (!isRecord(value) || value.kind !== "pipeline") return undefined;

	const project = asString(value.project);
	const iid = asNumber(value.iid);

	if (project === undefined || iid === undefined) return undefined;

	return {
		kind: "pipeline",
		project,
		iid,
		pipeline: asPipeline(value.pipeline),
	};
}

/**
 * Narrow one response body to a job log document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export function asJobLogPanel(value: unknown): JobLogPanel | undefined {
	if (!isRecord(value) || value.kind !== "job_log") return undefined;

	const project = asString(value.project);
	const job = asJob(value.job);

	if (project === undefined || job === undefined) return undefined;

	return {
		kind: "job_log",
		project,
		job,
		log: typeof value.log === "string" ? value.log : "",
		truncated: value.truncated === true,
	};
}

/**
 * Narrow one response body to a review draft.
 * @param value - the parsed JSON the host answered with.
 * @returns the draft, or undefined when it is not one this version can show.
 */
export function asReviewDraft(value: unknown): ReviewDraft | undefined {
	if (!isRecord(value)) return undefined;
	if (!isReviewAction(value.action)) return undefined;

	const summary = asString(value.summary);
	const subject = asString(value.subject);

	if (summary === undefined || subject === undefined) return undefined;

	const body = asString(value.body);
	const discussionId = asString(value.discussionId);

	return {
		action: value.action,
		summary,
		subject,
		...(body === undefined ? {} : { body }),
		...(discussionId === undefined ? {} : { discussionId }),
	};
}

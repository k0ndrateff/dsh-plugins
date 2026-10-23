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

import {
	fallback,
	isTrue,
	list,
	literal,
	nonEmptyString,
	notFalse,
	number,
	object,
	optional,
	type Reader,
	required,
	string,
	trueOnly,
} from "dsh-integration-host/shape";

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

/** One person on a merge request. */
const person = object<PanelPerson>({
	username: required(nonEmptyString),
	name: optional(nonEmptyString),
	bot: optional(trueOnly),
});

/** Where a note was written; a record with none of the three is no position. */
const position = object<NotePosition>({
	file: optional(nonEmptyString),
	oldLine: optional(number),
	newLine: optional(number),
});

const readPosition: Reader<NotePosition> = (value) => {
	const parsed = position(value);

	return parsed !== undefined && Object.keys(parsed).length > 0
		? parsed
		: undefined;
};

/** One note of a discussion. */
const note = object<DiscussionNote>({
	id: optional(nonEmptyString),
	author: optional(person),
	body: required(nonEmptyString),
	createdAt: optional(nonEmptyString),
	system: required(isTrue),
	internal: required(isTrue),
	position: optional(readPosition),
});

/** One discussion thread. */
const discussion = object<Discussion>({
	id: required(nonEmptyString),
	resolved: required(isTrue),
	resolvable: required(notFalse),
	notes: required(list(note)),
});

/** One file of a diff. */
const diffFile = object<DiffFile>({
	path: required(nonEmptyString),
	oldPath: optional(nonEmptyString),
	newFile: required(isTrue),
	deletedFile: required(isTrue),
	renamedFile: required(isTrue),
	added: fallback(number, 0),
	removed: fallback(number, 0),
	patch: optional(nonEmptyString),
});

/** One CI job. */
const job = object<PipelineJob>({
	id: required(number),
	name: required(nonEmptyString),
	stage: optional(nonEmptyString),
	status: required(nonEmptyString),
	failureReason: optional(nonEmptyString),
	url: optional(nonEmptyString),
	allowFailure: required(isTrue),
});

/** The head pipeline, or null when the document names none. */
const pipeline = object<PipelineSummary>({
	id: required(number),
	status: required(nonEmptyString),
	url: optional(nonEmptyString),
	source: optional(nonEmptyString),
	ref: optional(nonEmptyString),
	jobs: required(list(job)),
});

const readPipeline: Reader<PipelineSummary | null> = (value) =>
	pipeline(value) ?? null;

const mergeRequest = object<MergeRequestDetail>({
	project: required(nonEmptyString),
	iid: required(number),
	title: required(nonEmptyString),
	url: optional(nonEmptyString),
	state: optional(nonEmptyString),
	draft: required(isTrue),
	author: optional(person),
	assignees: required(list(person)),
	reviewers: required(list(person)),
	labels: required(list(string)),
	sourceBranch: optional(nonEmptyString),
	targetBranch: optional(nonEmptyString),
	createdAt: optional(nonEmptyString),
	updatedAt: optional(nonEmptyString),
	mergeStatus: optional(nonEmptyString),
	hasConflicts: required(isTrue),
	userNotesCount: optional(number),
	diffHeadSha: optional(nonEmptyString),
	description: optional(nonEmptyString),
});

/** One section name, as a tab passes it. */
const tab: Reader<PanelTab> = (value) =>
	isPanelTab(value) ? value : undefined;

/** One review action, as a draft passes it. */
const action: Reader<ReviewAction> = (value) =>
	isReviewAction(value) ? value : undefined;

/**
 * Narrow one tab's navigation parameters.
 * @param value - the opaque parameters a tab was opened with.
 * @returns the target, or undefined when this tab was opened without one.
 */
export const asPanelTarget = object<PanelTarget>({
	project: required(nonEmptyString),
	iid: required(number),
	tab: optional(tab),
});

/**
 * Narrow one response body to a merge request document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export const asMergeRequestPanel = object<MergeRequestPanel>({
	kind: required(literal("merge_request")),
	mr: required(mergeRequest),
	diffs: required(list(diffFile)),
	discussions: required(list(discussion)),
	truncated: optional(trueOnly),
});

/**
 * Narrow one response body to a pipeline document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export const asPipelinePanel = object<PipelinePanel>({
	kind: required(literal("pipeline")),
	project: required(nonEmptyString),
	iid: required(number),
	pipeline: required(readPipeline),
});

/**
 * Narrow one response body to a job log document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export const asJobLogPanel = object<JobLogPanel>({
	kind: required(literal("job_log")),
	project: required(nonEmptyString),
	job: required(job),
	log: fallback(string, ""),
	truncated: required(isTrue),
});

/**
 * Narrow one response body to a review draft.
 * @param value - the parsed JSON the host answered with.
 * @returns the draft, or undefined when it is not one this version can show.
 */
export const asReviewDraft = object<ReviewDraft>({
	action: required(action),
	summary: required(nonEmptyString),
	subject: required(nonEmptyString),
	body: optional(nonEmptyString),
	discussionId: optional(nonEmptyString),
});

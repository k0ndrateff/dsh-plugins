/**
 * What a GitLab card shows, on both sides of the wire.
 *
 * The host half reads these rows out of GitLab's MCP answers, records them as a
 * tool result's `presentationMeta`, and the browser half narrows them out of the
 * persisted result to draw the card under the agent's answer. The payload is
 * opaque JSON on the wire, so both halves share the types and the browser half
 * validates before rendering.
 */

import {
	fallback,
	isRecord,
	isTrue,
	list,
	literal,
	nonEmptyString,
	number,
	object,
	oneOf,
	optional,
	type Reader,
	required,
	trueOnly,
} from "dsh-integration-host/shape";

/** How much room one card gives each item. */
export type PresentationLayout = "single" | "compact" | "list";

/** What the tool accepts; `auto` is resolved by the host before recording. */
export type PresentationLayoutInput = PresentationLayout | "auto";

/** One merge request, as a card row shows it. */
export interface MergeRequestCard {
	/** Full path of the project the merge request lives in. */
	readonly project: string;
	/** Project-local id, as GitLab spells it: `!123`. */
	readonly iid: number;
	readonly title: string;
	readonly url?: string;
	/** `opened`, `merged`, `closed`, as the server words it. */
	readonly state?: string;
	/** Whether GitLab still marks it as a draft. */
	readonly draft?: boolean;
	readonly author?: string;
	readonly reviewers?: readonly string[];
	readonly sourceBranch?: string;
	readonly targetBranch?: string;
	/** The head pipeline's status, when the answer named one. */
	readonly pipeline?: string;
	readonly updatedAt?: string;
	/** How many notes the merge request has. */
	readonly notes?: number;
	/** How many discussions are still unresolved. */
	readonly unresolved?: number;
}

/** One review finding — a discussion thread, usually a bot's. */
export interface FindingCard {
	readonly project: string;
	readonly iid: number;
	/** The thread's id, which every review action names. */
	readonly discussionId: string;
	readonly file?: string;
	readonly line?: number;
	/** Whether the line belongs to the old or the new side of the diff. */
	readonly lineSide?: "old" | "new";
	readonly author?: string;
	readonly resolved: boolean;
	/** The note's own words, bounded to a sentence or two. */
	readonly body: string;
	readonly url?: string;
}

/** One CI job, as a card row shows it. */
export interface JobCard {
	readonly project: string;
	/** The merge request whose pipeline the job belongs to. */
	readonly iid: number;
	readonly id: number;
	readonly name: string;
	readonly stage?: string;
	/** `failed`, `success`, `running`, … as the server words it. */
	readonly status: string;
	/** GitLab's own reason, such as `script_failure`. */
	readonly failureReason?: string;
	readonly url?: string;
}

/** One thing on the card. */
export type PresentationItem =
	| { readonly kind: "merge_request"; readonly mergeRequest: MergeRequestCard }
	| { readonly kind: "finding"; readonly finding: FindingCard }
	| { readonly kind: "job"; readonly job: JobCard };

/** One recorded card, as the browser half reads it. */
export interface GitLabPresentation {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	readonly title?: string;
	readonly layout: PresentationLayout;
	/** How many items matched, when that is more than the card shows. */
	readonly total?: number;
	/** The scope or query the list ran, as a human label the card shows. */
	readonly query?: string;
	/** Every filter the list applied, so the card names them all. */
	readonly filters?: readonly string[];
	/** The merge request a findings or jobs card belongs to, as `group/project!12`. */
	readonly subject?: string;
	/** Whether GitLab had more rows than the card shows. */
	readonly truncated?: boolean;
	readonly items: readonly PresentationItem[];
}

/** A non-empty list; an empty one is the same as no field. */
const reviewers: Reader<readonly string[]> = (value) => {
	const items = list<string>(nonEmptyString)(value) ?? [];

	return items.length === 0 ? undefined : items;
};

/** One merge request. */
const mergeRequest = object<MergeRequestCard>({
	project: required(nonEmptyString),
	iid: required(number),
	title: required(nonEmptyString),
	url: optional(nonEmptyString),
	state: optional(nonEmptyString),
	draft: optional((value) => (typeof value === "boolean" ? value : undefined)),
	author: optional(nonEmptyString),
	reviewers: optional(reviewers),
	sourceBranch: optional(nonEmptyString),
	targetBranch: optional(nonEmptyString),
	pipeline: optional(nonEmptyString),
	updatedAt: optional(nonEmptyString),
	notes: optional(number),
	unresolved: optional(number),
});

/** One review finding. */
const finding = object<FindingCard>({
	project: required(nonEmptyString),
	iid: required(number),
	discussionId: required(nonEmptyString),
	file: optional(nonEmptyString),
	line: optional(number),
	lineSide: optional(oneOf<"old" | "new">(literal("old"), literal("new"))),
	author: optional(nonEmptyString),
	resolved: required(isTrue),
	body: required(nonEmptyString),
	url: optional(nonEmptyString),
});

/** One CI job. */
const job = object<JobCard>({
	project: required(nonEmptyString),
	iid: required(number),
	id: required(number),
	name: required(nonEmptyString),
	stage: optional(nonEmptyString),
	status: required(nonEmptyString),
	failureReason: optional(nonEmptyString),
	url: optional(nonEmptyString),
});

/** One item on the card. */
const item = oneOf<PresentationItem>(
	object<Extract<PresentationItem, { kind: "merge_request" }>>({
		kind: required(literal("merge_request")),
		mergeRequest: required(mergeRequest),
	}),
	object<Extract<PresentationItem, { kind: "finding" }>>({
		kind: required(literal("finding")),
		finding: required(finding),
	}),
	object<Extract<PresentationItem, { kind: "job" }>>({
		kind: required(literal("job")),
		job: required(job),
	}),
);

const layout = oneOf<PresentationLayout>(
	literal("single"),
	literal("compact"),
	literal("list"),
);

const presentation = object<GitLabPresentation>({
	callId: required(nonEmptyString),
	title: optional(nonEmptyString),
	layout: fallback(layout, "list"),
	total: optional(number),
	query: optional(nonEmptyString),
	filters: optional(list(nonEmptyString)),
	subject: optional(nonEmptyString),
	truncated: optional(trueOnly),
	items: required(list(item)),
});

/**
 * Validate one opaque card payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the card, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render.
 */
export function asGitLabPresentation(
	value: unknown,
): GitLabPresentation | undefined {
	if (!isRecord(value) || !Array.isArray(value.items)) return undefined;

	const parsed = presentation(value);

	if (parsed === undefined || parsed.items.length === 0) return undefined;

	const { total, ...rest } = parsed;

	return total === undefined || total <= parsed.items.length
		? rest
		: { ...rest, total };
}

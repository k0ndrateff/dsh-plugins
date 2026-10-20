/**
 * What a GitLab card shows, on both sides of the wire.
 *
 * The host half reads these rows out of GitLab's MCP answers, records them as a
 * tool result's `presentationMeta`, and the browser half narrows them out of the
 * persisted result to draw the card under the agent's answer. The payload is
 * opaque JSON on the wire, so both halves share the types and the browser half
 * validates before rendering.
 */

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
	/** The scope or query the list ran, as the server echoed it. */
	readonly query?: string;
	/** The merge request a findings or jobs card belongs to, as `group/project!12`. */
	readonly subject?: string;
	readonly items: readonly PresentationItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return value.filter(
		(item): item is string => typeof item === "string" && item !== "",
	);
}

function asMergeRequest(value: unknown): MergeRequestCard | undefined {
	if (!isRecord(value)) return undefined;

	const project = optionalString(value.project);
	const iid = optionalNumber(value.iid);
	const title = optionalString(value.title);

	if (project === undefined || iid === undefined || title === undefined)
		return undefined;

	const url = optionalString(value.url);
	const state = optionalString(value.state);
	const draft = optionalBoolean(value.draft);
	const author = optionalString(value.author);
	const sourceBranch = optionalString(value.sourceBranch);
	const targetBranch = optionalString(value.targetBranch);
	const pipeline = optionalString(value.pipeline);
	const updatedAt = optionalString(value.updatedAt);
	const notes = optionalNumber(value.notes);
	const unresolved = optionalNumber(value.unresolved);
	const reviewers = stringList(value.reviewers);

	return {
		project,
		iid,
		title,
		...(url === undefined ? {} : { url }),
		...(state === undefined ? {} : { state }),
		...(draft === undefined ? {} : { draft }),
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

function asFinding(value: unknown): FindingCard | undefined {
	if (!isRecord(value)) return undefined;

	const project = optionalString(value.project);
	const iid = optionalNumber(value.iid);
	const discussionId = optionalString(value.discussionId);
	const body = optionalString(value.body);

	if (
		project === undefined ||
		iid === undefined ||
		discussionId === undefined ||
		body === undefined
	)
		return undefined;

	const file = optionalString(value.file);
	const line = optionalNumber(value.line);
	const author = optionalString(value.author);
	const url = optionalString(value.url);

	return {
		project,
		iid,
		discussionId,
		body,
		resolved: value.resolved === true,
		...(file === undefined ? {} : { file }),
		...(line === undefined ? {} : { line }),
		...(author === undefined ? {} : { author }),
		...(url === undefined ? {} : { url }),
	};
}

function asJob(value: unknown): JobCard | undefined {
	if (!isRecord(value)) return undefined;

	const project = optionalString(value.project);
	const iid = optionalNumber(value.iid);
	const id = optionalNumber(value.id);
	const name = optionalString(value.name);
	const status = optionalString(value.status);

	if (
		project === undefined ||
		iid === undefined ||
		id === undefined ||
		name === undefined ||
		status === undefined
	)
		return undefined;

	const stage = optionalString(value.stage);
	const failureReason = optionalString(value.failureReason);
	const url = optionalString(value.url);

	return {
		project,
		iid,
		id,
		name,
		status,
		...(stage === undefined ? {} : { stage }),
		...(failureReason === undefined ? {} : { failureReason }),
		...(url === undefined ? {} : { url }),
	};
}

function asItem(value: unknown): PresentationItem | undefined {
	if (!isRecord(value)) return undefined;

	if (value.kind === "merge_request") {
		const mergeRequest = asMergeRequest(value.mergeRequest);

		return mergeRequest === undefined
			? undefined
			: { kind: "merge_request", mergeRequest };
	}

	if (value.kind === "finding") {
		const finding = asFinding(value.finding);

		return finding === undefined ? undefined : { kind: "finding", finding };
	}

	if (value.kind === "job") {
		const job = asJob(value.job);

		return job === undefined ? undefined : { kind: "job", job };
	}

	return undefined;
}

/**
 * Validate one opaque card payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the card, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render.
 */
export function asGitLabPresentation(
	value: unknown,
): GitLabPresentation | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (!Array.isArray(value.items)) return undefined;

	const items: PresentationItem[] = [];
	for (const candidate of value.items) {
		const item = asItem(candidate);
		if (item !== undefined) items.push(item);
	}

	if (items.length === 0) return undefined;

	const layout: PresentationLayout =
		value.layout === "single" ||
		value.layout === "compact" ||
		value.layout === "list"
			? value.layout
			: "list";

	const title = optionalString(value.title);
	const query = optionalString(value.query);
	const subject = optionalString(value.subject);
	const total = optionalNumber(value.total);

	return {
		callId: value.callId,
		layout,
		items,
		...(title === undefined ? {} : { title }),
		...(query === undefined ? {} : { query }),
		...(subject === undefined ? {} : { subject }),
		...(total === undefined || total <= items.length ? {} : { total }),
	};
}

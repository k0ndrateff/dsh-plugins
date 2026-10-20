/**
 * What a Sentry card and panel show, on both sides of the wire.
 *
 * Sentry's MCP server answers with Markdown, not JSON: a search is a list of
 * `## 1. [FRONTEND-13P](url)` sections, and one issue is a document with a
 * field block, a code location, a suspect commit, an error, a stack trace, and
 * a tag list. The host half reads that Markdown into these types, the tool's
 * `presentationMeta` carries them into the session log, and the browser half
 * narrows them out again to draw the card and the panel.
 */

/** How much room one card gives each item. */
export type PresentationLayout = "single" | "compact" | "list";

/** What the tool accepts; `auto` is resolved by the host before recording. */
export type PresentationLayoutInput = PresentationLayout | "auto";

/** One issue, as a card row shows it. */
export interface IssueCard {
	/** Short id, as Sentry spells it: `FRONTEND-13P`. */
	readonly id: string;
	/** The exception's own words. */
	readonly title: string;
	readonly url?: string;
	/** `unresolved`, `resolved`, `ignored`, … as the server words it. */
	readonly status?: string;
	readonly assignee?: string;
	/** How many events the issue has seen. */
	readonly events?: number;
	/** How many users it touched. */
	readonly users?: number;
	readonly firstSeen?: string;
	readonly lastSeen?: string;
	/** The transaction the error came from. */
	readonly culprit?: string;
	readonly project?: string;
}

/** The commit Sentry suspects, when its SCM integration knows one. */
export interface SuspectCommit {
	readonly sha: string;
	readonly message?: string;
	readonly author?: string;
	/** A tracker key the message names, such as `DEV-5977`. */
	readonly issueKey?: string;
	readonly source?: string;
}

/** Where in the code the error was raised. */
export interface CodeLocation {
	readonly repository?: string;
	readonly path?: string;
	readonly line?: number;
	readonly url?: string;
}

/** One tag of an event, in the order Sentry printed it. */
export interface IssueTag {
	readonly name: string;
	readonly value: string;
}

/** The whole issue, as the panel reads it. */
export interface IssueDetail {
	readonly id: string;
	readonly url?: string;
	readonly description?: string;
	readonly culprit?: string;
	readonly status?: string;
	readonly substatus?: string;
	readonly assignee?: string;
	readonly project?: string;
	readonly platform?: string;
	readonly issueType?: string;
	readonly occurrences?: number;
	readonly users?: number;
	readonly firstSeen?: string;
	readonly lastSeen?: string;
	readonly code?: CodeLocation;
	readonly suspect?: SuspectCommit;
	readonly eventId?: string;
	readonly occurredAt?: string;
	/** The exception line, as the `### Error` block prints it. */
	readonly message?: string;
	/** The full stack trace, as text. */
	readonly stacktrace?: string;
	readonly tags: readonly IssueTag[];
	/** The document the fields were read from, kept for a raw view. */
	readonly raw: string;
}

/** One recorded card, as the browser half reads it. */
export interface SentryPresentation {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	readonly title?: string;
	readonly layout: PresentationLayout;
	/** The server's own match count, when it exceeds what the card shows. */
	readonly total?: number;
	/** The query the search ran, as the server echoed it. */
	readonly query?: string;
	/** Sentry's own link to the results, when the answer carried one. */
	readonly dashboardUrl?: string;
	readonly issues: readonly IssueCard[];
	/** The suspect commit, when the card is about one issue. */
	readonly suspect?: SuspectCommit;
}

/** What one panel load answers with. */
export interface IssuePanel {
	readonly issue: IssueDetail;
	/** The organization slug the panel's actions must name. */
	readonly organization: string | null;
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

function asIssue(value: unknown): IssueCard | undefined {
	if (!isRecord(value)) return undefined;

	const id = optionalString(value.id);
	const title = optionalString(value.title);

	if (id === undefined || title === undefined) return undefined;

	return {
		id,
		title,
		...(optionalString(value.url) === undefined
			? {}
			: { url: value.url as string }),
		...(optionalString(value.status) === undefined
			? {}
			: { status: value.status as string }),
		...(optionalString(value.assignee) === undefined
			? {}
			: { assignee: value.assignee as string }),
		...(optionalNumber(value.events) === undefined
			? {}
			: { events: value.events as number }),
		...(optionalNumber(value.users) === undefined
			? {}
			: { users: value.users as number }),
		...(optionalString(value.firstSeen) === undefined
			? {}
			: { firstSeen: value.firstSeen as string }),
		...(optionalString(value.lastSeen) === undefined
			? {}
			: { lastSeen: value.lastSeen as string }),
		...(optionalString(value.culprit) === undefined
			? {}
			: { culprit: value.culprit as string }),
		...(optionalString(value.project) === undefined
			? {}
			: { project: value.project as string }),
	};
}

function asSuspect(value: unknown): SuspectCommit | undefined {
	if (!isRecord(value)) return undefined;

	const sha = optionalString(value.sha);
	if (sha === undefined) return undefined;

	return {
		sha,
		...(optionalString(value.message) === undefined
			? {}
			: { message: value.message as string }),
		...(optionalString(value.author) === undefined
			? {}
			: { author: value.author as string }),
		...(optionalString(value.issueKey) === undefined
			? {}
			: { issueKey: value.issueKey as string }),
		...(optionalString(value.source) === undefined
			? {}
			: { source: value.source as string }),
	};
}

function asCode(value: unknown): CodeLocation | undefined {
	if (!isRecord(value)) return undefined;

	const line = optionalNumber(value.line);

	return {
		...(optionalString(value.repository) === undefined
			? {}
			: { repository: value.repository as string }),
		...(optionalString(value.path) === undefined
			? {}
			: { path: value.path as string }),
		...(line === undefined ? {} : { line }),
		...(optionalString(value.url) === undefined
			? {}
			: { url: value.url as string }),
	};
}

function asTags(value: unknown): IssueTag[] {
	const tags: IssueTag[] = [];

	if (!Array.isArray(value)) return tags;

	for (const candidate of value) {
		if (!isRecord(candidate)) continue;

		const name = optionalString(candidate.name);
		const tag = optionalString(candidate.value);

		if (name !== undefined && tag !== undefined)
			tags.push({ name, value: tag });
	}

	return tags;
}

/** Read one issue document off the wire, keeping what the panel draws. */
function asDetail(value: unknown): IssueDetail | undefined {
	if (!isRecord(value)) return undefined;

	const id = optionalString(value.id);
	if (id === undefined) return undefined;

	const url = optionalString(value.url);
	const description = optionalString(value.description);
	const culprit = optionalString(value.culprit);
	const status = optionalString(value.status);
	const substatus = optionalString(value.substatus);
	const assignee = optionalString(value.assignee);
	const project = optionalString(value.project);
	const platform = optionalString(value.platform);
	const issueType = optionalString(value.issueType);
	const firstSeen = optionalString(value.firstSeen);
	const lastSeen = optionalString(value.lastSeen);
	const eventId = optionalString(value.eventId);
	const occurredAt = optionalString(value.occurredAt);
	const message = optionalString(value.message);
	const stacktrace = optionalString(value.stacktrace);
	const occurrences = optionalNumber(value.occurrences);
	const users = optionalNumber(value.users);
	const code = asCode(value.code);
	const suspect = asSuspect(value.suspect);

	return {
		id,
		tags: asTags(value.tags),
		raw: typeof value.raw === "string" ? value.raw : "",
		...(url === undefined ? {} : { url }),
		...(description === undefined ? {} : { description }),
		...(culprit === undefined ? {} : { culprit }),
		...(status === undefined ? {} : { status }),
		...(substatus === undefined ? {} : { substatus }),
		...(assignee === undefined ? {} : { assignee }),
		...(project === undefined ? {} : { project }),
		...(platform === undefined ? {} : { platform }),
		...(issueType === undefined ? {} : { issueType }),
		...(firstSeen === undefined ? {} : { firstSeen }),
		...(lastSeen === undefined ? {} : { lastSeen }),
		...(eventId === undefined ? {} : { eventId }),
		...(occurredAt === undefined ? {} : { occurredAt }),
		...(message === undefined ? {} : { message }),
		...(stacktrace === undefined ? {} : { stacktrace }),
		...(occurrences === undefined ? {} : { occurrences }),
		...(users === undefined ? {} : { users }),
		...(code === undefined ? {} : { code }),
		...(suspect === undefined ? {} : { suspect }),
	};
}

/**
 * Validate one opaque panel document.
 * @param value - what `/dsh-sentry/issue` answered with.
 * @returns the panel, or undefined when the document is not one this version
 *   can draw — a panel that cannot be validated renders its error state rather
 *   than a half-empty issue.
 */
export function asIssuePanel(value: unknown): IssuePanel | undefined {
	if (!isRecord(value)) return undefined;

	const issue = asDetail(value.issue);
	if (issue === undefined) return undefined;

	const organization = optionalString(value.organization);

	return { issue, organization: organization ?? null };
}

/**
 * Validate one opaque card payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the card, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render.
 */
export function asSentryPresentation(
	value: unknown,
): SentryPresentation | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (!Array.isArray(value.issues)) return undefined;

	const issues: IssueCard[] = [];
	for (const candidate of value.issues) {
		const issue = asIssue(candidate);
		if (issue !== undefined) issues.push(issue);
	}

	if (issues.length === 0) return undefined;

	const layout: PresentationLayout =
		value.layout === "single" ||
		value.layout === "compact" ||
		value.layout === "list"
			? value.layout
			: "list";

	return {
		callId: value.callId,
		layout,
		issues,
		...(optionalString(value.title) === undefined
			? {}
			: { title: value.title as string }),
		...(optionalNumber(value.total) === undefined
			? {}
			: { total: value.total as number }),
		...(optionalString(value.query) === undefined
			? {}
			: { query: value.query as string }),
		...(optionalString(value.dashboardUrl) === undefined
			? {}
			: { dashboardUrl: value.dashboardUrl as string }),
		...(asSuspect(value.suspect) === undefined
			? {}
			: { suspect: asSuspect(value.suspect) }),
	};
}

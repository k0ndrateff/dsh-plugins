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

import {
	fallback,
	isRecord,
	list,
	literal,
	nonEmptyString,
	number,
	object,
	oneOf,
	optional,
	type Reader,
	required,
} from "dsh-integration-host/shape";

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
	readonly occurrences?: number;
	readonly users?: number;
	readonly firstSeen?: string;
	readonly lastSeen?: string;
	readonly code?: CodeLocation;
	readonly suspect?: SuspectCommit;
	/** The exception line, as the `### Error` block prints it. */
	readonly message?: string;
	/** The full stack trace, as text. */
	readonly stacktrace?: string;
	readonly tags: readonly IssueTag[];
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
	/** The organization the rows were read from. */
	readonly organization?: string;
	readonly issues: readonly IssueCard[];
	/** The suspect commit, when the card is about one issue. */
	readonly suspect?: SuspectCommit;
}

/** What one panel load answers with. */
export interface IssuePanel {
	readonly issue: IssueDetail;
	/** The organization slug the panel's actions must name. */
	readonly organization: string | null;
	/** That organization's web URL, when Sentry named one. */
	readonly organizationUrl?: string;
}

/** One issue, as a card row shows it. */
const issue = object<IssueCard>({
	id: required(nonEmptyString),
	title: required(nonEmptyString),
	url: optional(nonEmptyString),
	status: optional(nonEmptyString),
	assignee: optional(nonEmptyString),
	events: optional(number),
	users: optional(number),
	firstSeen: optional(nonEmptyString),
	lastSeen: optional(nonEmptyString),
	culprit: optional(nonEmptyString),
	project: optional(nonEmptyString),
});

/** The commit Sentry suspects. */
const suspect = object<SuspectCommit>({
	sha: required(nonEmptyString),
	message: optional(nonEmptyString),
	author: optional(nonEmptyString),
	issueKey: optional(nonEmptyString),
	source: optional(nonEmptyString),
});

/** Where in the code the error was raised. */
const code = object<CodeLocation>({
	repository: optional(nonEmptyString),
	path: optional(nonEmptyString),
	line: optional(number),
	url: optional(nonEmptyString),
});

/** One tag of an event. */
const tag = object<IssueTag>({
	name: required(nonEmptyString),
	value: required(nonEmptyString),
});

/** The whole issue, as the panel reads it. */
const detail = object<IssueDetail>({
	id: required(nonEmptyString),
	url: optional(nonEmptyString),
	description: optional(nonEmptyString),
	culprit: optional(nonEmptyString),
	status: optional(nonEmptyString),
	substatus: optional(nonEmptyString),
	assignee: optional(nonEmptyString),
	project: optional(nonEmptyString),
	platform: optional(nonEmptyString),
	occurrences: optional(number),
	users: optional(number),
	firstSeen: optional(nonEmptyString),
	lastSeen: optional(nonEmptyString),
	code: optional(code),
	suspect: optional(suspect),
	message: optional(nonEmptyString),
	stacktrace: optional(nonEmptyString),
	tags: required(list(tag)),
});

/** The organization is null when the document names none. */
const organization: Reader<string | null> = (value) =>
	nonEmptyString(value) ?? null;

const layout = oneOf<PresentationLayout>(
	literal("single"),
	literal("compact"),
	literal("list"),
);

const presentation = object<SentryPresentation>({
	callId: required(nonEmptyString),
	layout: fallback(layout, "list"),
	title: optional(nonEmptyString),
	total: optional(number),
	query: optional(nonEmptyString),
	dashboardUrl: optional(nonEmptyString),
	organization: optional(nonEmptyString),
	issues: required(list(issue)),
	suspect: optional(suspect),
});

/**
 * Validate one opaque panel document.
 * @param value - what `/dsh-sentry/issue` answered with.
 * @returns the panel, or undefined when the document is not one this version
 *   can draw — a panel that cannot be validated renders its error state rather
 *   than a half-empty issue.
 */
export function asIssuePanel(value: unknown): IssuePanel | undefined {
	const parsed = object<IssuePanel>({
		issue: required(detail),
		organization: required(organization),
		organizationUrl: optional(nonEmptyString),
	})(value);

	return parsed;
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
	if (!isRecord(value) || !Array.isArray(value.issues)) return undefined;

	const parsed = presentation(value);

	return parsed !== undefined && parsed.issues.length > 0 ? parsed : undefined;
}

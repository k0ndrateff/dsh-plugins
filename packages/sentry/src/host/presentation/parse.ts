/**
 * Reading Sentry's Markdown answers.
 *
 * The MCP server does not answer its issue tools with JSON — it answers with a
 * document meant for a person, and says so itself ("**Suggested presentation:**
 * Cards work well for these issues"). So the card and the panel are built by
 * reading that document: a search is a numbered list of issue sections, and one
 * issue is a field block followed by code location, suspect commit, error,
 * stack trace, and tags.
 *
 * Every reader here is a pure function of the text, which is what lets the real
 * captures in `test/parse.ts` stand in for a live account.
 */

import type {
	CodeLocation,
	IssueCard,
	IssueDetail,
	IssueTag,
	SuspectCommit,
} from "../../shared/meta";

/** The whole search answer: its issues, its query, and its dashboard link. */
export interface IssueSearch {
	readonly issues: readonly IssueCard[];
	readonly query?: string;
	readonly dashboardUrl?: string;
	/** The count the answer claims, when it claims one. */
	readonly total?: number;
}

/** `# Search Results for "is:unresolved"` */
const SEARCH_HEADING = /^#\s+Search Results for\s+"?(.*?)"?\s*$/u;

/** `Found **3** issues:` */
const FOUND = /^Found \*\*(\d+)\*\*/u;

/** `## 1. [FRONTEND-13P](https://…)` */
const ISSUE_HEADING = /^##\s+\d+\.\s+\[([^\]]+)\]\(([^)]+)\)\s*$/u;

/** `- **Status**: unresolved` */
const FIELD = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/u;

/** `**AxiosError: Request failed with status code 422**` */
const TITLE = /^\*\*(.+)\*\*$/u;

/** The line under `**View these results in Sentry**:`. */
const VIEW_RESULTS = /^\*\*View these results in Sentry\*\*:?\s*$/u;

/** A bare URL on its own line. */
const BARE_URL = /^https?:\/\/\S+$/u;

/** The card field each name a search row prints belongs to. */
const ROW_FIELDS = {
	status: "status",
	users: "users",
	events: "events",
	assignee: "assigned to",
	firstSeen: "first seen",
	lastSeen: "last seen",
	culprit: "culprit",
	project: "project",
} as const;

/** `**Description**: AxiosError: …` */
const DETAIL_FIELD = /^\*\*(.+?)\*\*:\s*(.*)$/u;

/** `## Code Location`, `## Suspect Commit`, `## Event Details` */
const SECTION = /^##\s+(.+?)\s*$/u;

/** `### Error`, `### Tags`, `### User` */
const SUBSECTION = /^###\s+(.+?)\s*$/u;

/** The tracker key a commit message may name, such as `DEV-5977`. */
const TRACKER_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/u;

/** `2 minutes ago`, the shape Sentry prints for a search row's times. */
const RELATIVE_TIME =
	/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/iu;

/** How long one of Sentry's relative units is, for turning it into a moment. */
const UNIT_MS: Readonly<Record<string, number>> = {
	second: 1_000,
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 604_800_000,
	month: 2_592_000_000,
	year: 31_536_000_000,
};

/**
 * One time as an absolute timestamp.
 *
 * A search row prints "2 minutes ago", which is true only at the moment the
 * answer was read: a card is a durable record, so the phrase is resolved
 * against that moment and stored as a timestamp the renderer formats itself.
 * @param value - a timestamp, or Sentry's relative phrase.
 * @param now - the moment the answer was read, in epoch milliseconds.
 * @returns an ISO timestamp, or the input when it names no time.
 */
function absoluteTime(value: string, now: number): string {
	const trimmed = value.trim();

	if (trimmed === "") return value;
	if (trimmed.toLowerCase() === "just now") return new Date(now).toISOString();

	const parsed = Date.parse(trimmed);

	if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();

	const relative = RELATIVE_TIME.exec(trimmed);

	if (relative === null) return value;

	const amount = Number(relative[1]);
	const unit = UNIT_MS[(relative[2] ?? "").toLowerCase()];

	return unit === undefined
		? value
		: new Date(now - amount * unit).toISOString();
}

/** A field's value without the backticks a server may wrap it in. */
function unquoted(value: string): string {
	const trimmed = value.trim();

	if (trimmed.length >= 2 && trimmed.startsWith("`") && trimmed.endsWith("`"))
		return trimmed.slice(1, -1).trim();

	return trimmed;
}

/** The number a field carries, when it carries one. */
function numberIn(text: string): number | undefined {
	const match = /(\d[\d,]*)/u.exec(text);
	const value =
		match?.[1] === undefined ? undefined : Number(match[1].replace(/,/gu, ""));

	return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Read one issue search answer.
 * @param text - the Markdown `search_issues` printed.
 * @returns the issues it lists, the query it echoed, and its dashboard link.
 */
export function parseIssueSearch(
	text: string,
	now: number = Date.now(),
): IssueSearch {
	const issues: IssueCard[] = [];
	let query: string | undefined;
	let dashboardUrl: string | undefined;
	let total: number | undefined;
	let current:
		| {
				id: string;
				url: string;
				title?: string;
				fields: Map<string, string>;
		  }
		| undefined;
	let waitingForUrl = false;

	const flush = (): void => {
		if (current === undefined) return;

		const field = (name: keyof typeof ROW_FIELDS): string | undefined =>
			current?.fields.get(ROW_FIELDS[name]);
		const events = numberIn(field("events") ?? "");
		const users = numberIn(field("users") ?? "");

		issues.push({
			id: current.id,
			title: current.title ?? current.id,
			url: current.url,
			...(field("status") === undefined ? {} : { status: field("status") }),
			...(field("assignee") === undefined
				? {}
				: { assignee: field("assignee") }),
			...(events === undefined ? {} : { events }),
			...(users === undefined ? {} : { users }),
			...(field("firstSeen") === undefined
				? {}
				: {
						firstSeen: absoluteTime(String(field("firstSeen")), now),
					}),
			...(field("lastSeen") === undefined
				? {}
				: { lastSeen: absoluteTime(String(field("lastSeen")), now) }),
			...(field("culprit") === undefined ? {} : { culprit: field("culprit") }),
			...(field("project") === undefined ? {} : { project: field("project") }),
		});
		current = undefined;
	};

	for (const line of text.split(/\r?\n/u)) {
		const heading = SEARCH_HEADING.exec(line);

		if (heading !== null) {
			query = heading[1]?.trim() === "" ? undefined : heading[1]?.trim();

			continue;
		}

		const found = FOUND.exec(line);

		if (found !== null) {
			total = Number(found[1]);

			continue;
		}

		if (VIEW_RESULTS.test(line)) {
			waitingForUrl = true;

			continue;
		}

		if (waitingForUrl) {
			const url = BARE_URL.exec(line.trim());

			if (url !== null) {
				dashboardUrl = url[0];
				waitingForUrl = false;
			}
		}

		const issue = ISSUE_HEADING.exec(line);

		if (issue !== null) {
			flush();
			current = {
				id: issue[1] ?? "",
				url: issue[2] ?? "",
				fields: new Map<string, string>(),
			};

			continue;
		}

		if (current === undefined) continue;

		const field = FIELD.exec(line);

		if (field !== null) {
			current.fields.set(
				(field[1] ?? "").toLowerCase(),
				unquoted(field[2] ?? ""),
			);

			continue;
		}

		const title = TITLE.exec(line);

		if (title !== null && current.title === undefined && title[1] !== undefined)
			current.title = title[1].trim();
	}

	flush();

	return {
		issues,
		...(query === undefined ? {} : { query }),
		...(dashboardUrl === undefined ? {} : { dashboardUrl }),
		...(total === undefined ? {} : { total }),
	};
}

/** The fenced block that follows a label, such as `**Full Stacktrace:**`. */
function fencedBlock(
	lines: readonly string[],
	from: number,
): string | undefined {
	let index = from;

	while (index < lines.length && !(lines[index] ?? "").startsWith("```"))
		index += 1;
	if (index >= lines.length) return undefined;

	const body: string[] = [];
	index += 1;

	while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
		body.push(lines[index] ?? "");
		index += 1;
	}

	return body.join("\n").trimEnd();
}

/**
 * Read one issue document.
 * @param text - the Markdown `get_sentry_resource` printed for an issue.
 * @returns the fields, the code location, the suspect commit, the error, the
 *   stack trace, and the tags it carries.
 */
export function parseIssueDetail(
	text: string,
	now: number = Date.now(),
): IssueDetail {
	const lines = text.split(/\r?\n/u);
	const fields = new Map<string, string>();
	const tags: IssueTag[] = [];
	const code: Record<string, string> = {};
	const suspect: Record<string, string> = {};
	let section = "";
	let subsection = "";
	let message: string | undefined;
	let stacktrace: string | undefined;
	let id = "";

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const heading = /^#\s+Issue\s+(\S+)/u.exec(line);

		if (heading !== null) {
			id = heading[1] ?? "";

			continue;
		}

		const sectionHeading = SECTION.exec(line);

		if (sectionHeading !== null) {
			section = (sectionHeading[1] ?? "").toLowerCase();
			subsection = "";

			continue;
		}

		const subsectionHeading = SUBSECTION.exec(line);

		if (subsectionHeading !== null) {
			subsection = (subsectionHeading[1] ?? "").toLowerCase();

			if (subsection === "error" && message === undefined) {
				const block = fencedBlock(lines, index);

				if (block !== undefined) message = block.split("\n")[0]?.trim();
			}

			continue;
		}

		if (line.startsWith("**Full Stacktrace:**")) {
			stacktrace = fencedBlock(lines, index);

			continue;
		}

		const field = DETAIL_FIELD.exec(line);

		if (field !== null) {
			const name = (field[1] ?? "").toLowerCase();
			const value = unquoted(field[2] ?? "");

			// The tags live under the event section, so they are read before the
			// section's own field block rather than as part of it.
			if (subsection === "tags") tags.push({ name: field[1] ?? "", value });
			else if (section === "code location") code[name] = value;
			else if (section === "suspect commit") suspect[name] = value;
			else if (section === "" && subsection === "") fields.set(name, value);
		}
	}

	const field = (name: string): string | undefined => {
		const value = fields.get(name);

		return value === undefined || value === "" ? undefined : value;
	};

	return {
		id,
		...(field("url") === undefined ? {} : { url: field("url") }),
		...(field("description") === undefined
			? {}
			: { description: field("description") }),
		...(field("culprit") === undefined ? {} : { culprit: field("culprit") }),
		...(field("status") === undefined ? {} : { status: field("status") }),
		...(field("substatus") === undefined
			? {}
			: { substatus: field("substatus") }),
		...(field("assigned to") === undefined
			? {}
			: { assignee: field("assigned to") }),
		...(field("project") === undefined ? {} : { project: field("project") }),
		...(field("platform") === undefined ? {} : { platform: field("platform") }),
		...(numberIn(field("occurrences") ?? "") === undefined
			? {}
			: { occurrences: numberIn(field("occurrences") ?? "") }),
		...(numberIn(field("users impacted") ?? "") === undefined
			? {}
			: { users: numberIn(field("users impacted") ?? "") }),
		...(field("first seen") === undefined
			? {}
			: { firstSeen: absoluteTime(String(field("first seen")), now) }),
		...(field("last seen") === undefined
			? {}
			: { lastSeen: absoluteTime(String(field("last seen")), now) }),
		...codeLocation(code),
		...suspectCommit(suspect),
		...(message === undefined ? {} : { message }),
		...(stacktrace === undefined ? {} : { stacktrace }),
		tags,
	};
}

/** The code location a detail document names, when it names one. */
function codeLocation(fields: Readonly<Record<string, string>>): {
	code?: CodeLocation;
} {
	const line = fields.line === undefined ? undefined : numberIn(fields.line);

	if (fields.path === undefined && fields.repository === undefined) return {};

	return {
		code: {
			...(fields.repository === undefined
				? {}
				: { repository: fields.repository }),
			...(fields.path === undefined ? {} : { path: fields.path }),
			...(line === undefined ? {} : { line }),
			...(fields.source === undefined ? {} : { url: fields.source }),
		},
	};
}

/** The suspect commit a detail document names, when it names one. */
function suspectCommit(fields: Readonly<Record<string, string>>): {
	suspect?: SuspectCommit;
} {
	const sha = fields.sha;

	if (sha === undefined || sha === "") return {};

	const message = fields.message;
	const key =
		message === undefined ? undefined : TRACKER_KEY.exec(message)?.[1];

	return {
		suspect: {
			sha,
			...(message === undefined ? {} : { message }),
			...(fields.author === undefined ? {} : { author: fields.author }),
			...(fields.source === undefined ? {} : { source: fields.source }),
			...(key === undefined ? {} : { issueKey: key }),
		},
	};
}

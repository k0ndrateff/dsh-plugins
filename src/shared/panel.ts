/**
 * What the side panel shows, as the two halves agree on it.
 *
 * The host half resolves an issue or a page through the MCP connection and
 * answers the browser half with one of these documents over `/dsh-atlassian`;
 * the panel renders exactly what it is given. Both halves import these types,
 * and the browser half validates before trusting them, because the two halves
 * can be a version apart while a plugin is being developed.
 */

/** What a panel is opened on. */
export type PanelTarget =
	| { readonly kind: "issue"; readonly key: string }
	| { readonly kind: "page"; readonly id: string; readonly title?: string };

/** One comment on an issue or a page, in the site's own words. */
export type PanelComment = {
	readonly author?: string;
	/** When it was written, as the server stated it. */
	readonly created?: string;
	/** Markdown, as Jira or Confluence returned it. */
	readonly body: string;
};

/** A person, as Jira identifies them. */
export type PanelPerson = {
	readonly name: string;
	readonly accountId: string;
};

/** One status transition the workflow currently offers. */
export type PanelTransition = {
	readonly id: string;
	/** The transition's own name, in the site's language ("Start progress"). */
	readonly name: string;
	/** The status it lands in, when the server names one. */
	readonly to?: string;
	/** False when the workflow will not offer it for this issue right now. */
	readonly available: boolean;
	/**
	 * True when the transition opens a screen.
	 *
	 * This panel has no form, so it shows such a transition as unavailable
	 * rather than sending a call the server will reject for missing fields.
	 */
	readonly needsFields: boolean;
};

/** Everything the panel shows for one Jira issue. */
export type IssuePanel = {
	readonly kind: "issue";
	readonly key: string;
	readonly summary?: string;
	readonly type?: string;
	readonly status?: string;
	readonly priority?: string;
	readonly assignee?: PanelPerson;
	readonly reporter?: string;
	/** Jira's own estimate words ("3d 4h"). */
	readonly estimate?: string;
	readonly due?: string;
	readonly labels: readonly string[];
	readonly created?: string;
	readonly updated?: string;
	/** The description as Markdown, bounded. */
	readonly description?: string;
	/** The issue in the browser. */
	readonly url?: string;
	readonly comments: readonly PanelComment[];
	readonly transitions: readonly PanelTransition[];
};

/** Everything the panel shows for one Confluence page. */
export type PagePanel = {
	readonly kind: "page";
	readonly id: string;
	readonly title: string;
	readonly space?: string;
	readonly url?: string;
	/** The body as Markdown, bounded. */
	readonly body?: string;
	readonly comments: readonly PanelComment[];
};

/** One panel's document. */
export type PanelData = IssuePanel | PagePanel;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function asComments(value: unknown): PanelComment[] {
	if (!Array.isArray(value)) return [];

	const comments: PanelComment[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) continue;

		const body = asString(candidate.body);
		if (body === undefined) continue;

		comments.push({
			body,
			...(asString(candidate.author) === undefined
				? {}
				: { author: asString(candidate.author) }),
			...(asString(candidate.created) === undefined
				? {}
				: { created: asString(candidate.created) }),
		});
	}

	return comments;
}

function asTransitions(value: unknown): PanelTransition[] {
	if (!Array.isArray(value)) return [];

	const transitions: PanelTransition[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) continue;

		const id = asString(candidate.id);
		const name = asString(candidate.name);
		if (id === undefined || name === undefined) continue;

		transitions.push({
			id,
			name,
			...(asString(candidate.to) === undefined
				? {}
				: { to: asString(candidate.to) }),
			available: candidate.available !== false,
			needsFields: candidate.needsFields === true,
		});
	}

	return transitions;
}

function asPerson(value: unknown): PanelPerson | undefined {
	if (!isRecord(value)) return undefined;

	const name = asString(value.name);
	const accountId = asString(value.accountId);
	if (name === undefined || accountId === undefined) return undefined;

	return { name, accountId };
}

/**
 * Narrow one response body to a panel target.
 * @param value - an opaque `params` bag from the sidebar.
 * @returns the target, or undefined when it is not one this version understands.
 */
export function asPanelTarget(value: unknown): PanelTarget | undefined {
	if (!isRecord(value)) return undefined;

	if (value.kind === "issue") {
		const key = asString(value.key);
		return key === undefined ? undefined : { kind: "issue", key };
	}

	if (value.kind === "page") {
		const id = asString(value.id);
		if (id === undefined) return undefined;

		return {
			kind: "page",
			id,
			...(asString(value.title) === undefined
				? {}
				: { title: asString(value.title) }),
		};
	}

	return undefined;
}

/**
 * Narrow one response body to a panel document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export function asPanelData(value: unknown): PanelData | undefined {
	if (!isRecord(value)) return undefined;

	if (value.kind === "issue") {
		const key = asString(value.key);
		if (key === undefined) return undefined;

		const assignee = asPerson(value.assignee);

		return {
			kind: "issue",
			key,
			...(asString(value.summary) === undefined
				? {}
				: { summary: asString(value.summary) }),
			...(asString(value.type) === undefined
				? {}
				: { type: asString(value.type) }),
			...(asString(value.status) === undefined
				? {}
				: { status: asString(value.status) }),
			...(asString(value.priority) === undefined
				? {}
				: { priority: asString(value.priority) }),
			...(assignee === undefined ? {} : { assignee }),
			...(asString(value.reporter) === undefined
				? {}
				: { reporter: asString(value.reporter) }),
			...(asString(value.estimate) === undefined
				? {}
				: { estimate: asString(value.estimate) }),
			...(asString(value.due) === undefined
				? {}
				: { due: asString(value.due) }),
			labels: Array.isArray(value.labels)
				? value.labels.filter(
						(item): item is string => typeof item === "string",
					)
				: [],
			...(asString(value.created) === undefined
				? {}
				: { created: asString(value.created) }),
			...(asString(value.updated) === undefined
				? {}
				: { updated: asString(value.updated) }),
			...(asString(value.description) === undefined
				? {}
				: { description: asString(value.description) }),
			...(asString(value.url) === undefined
				? {}
				: { url: asString(value.url) }),
			comments: asComments(value.comments),
			transitions: asTransitions(value.transitions),
		};
	}

	if (value.kind === "page") {
		const id = asString(value.id);
		const title = asString(value.title);
		if (id === undefined || title === undefined) return undefined;

		return {
			kind: "page",
			id,
			title,
			...(asString(value.space) === undefined
				? {}
				: { space: asString(value.space) }),
			...(asString(value.url) === undefined
				? {}
				: { url: asString(value.url) }),
			...(asString(value.body) === undefined
				? {}
				: { body: asString(value.body) }),
			comments: asComments(value.comments),
		};
	}

	return undefined;
}

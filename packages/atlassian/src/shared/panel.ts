/**
 * What the side panel shows, as the two halves agree on it.
 *
 * The host half resolves an issue or a page through the MCP connection and
 * answers the browser half with one of these documents over `/dsh-atlassian`;
 * the panel renders exactly what it is given. Both halves import these types,
 * and the browser half validates before trusting them, because the two halves
 * can be a version apart while a plugin is being developed.
 */

import {
	isTrue,
	list,
	literal,
	nonEmptyString,
	notFalse,
	object,
	oneOf,
	optional,
	required,
	string,
} from "dsh-integration-host/shape";

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

/** One comment, as Jira or Confluence returned it. */
const comment = object<PanelComment>({
	body: required(nonEmptyString),
	author: optional(nonEmptyString),
	created: optional(nonEmptyString),
});

/** One workflow transition, with its two booleans read the way Jira sends them. */
const transition = object<PanelTransition>({
	id: required(nonEmptyString),
	name: required(nonEmptyString),
	to: optional(nonEmptyString),
	available: required(notFalse),
	needsFields: required(isTrue),
});

/** A person on an issue. */
const person = object<PanelPerson>({
	name: required(nonEmptyString),
	accountId: required(nonEmptyString),
});

/** One Jira issue, as the panel draws it. */
const issuePanel = object<IssuePanel>({
	kind: required(literal("issue")),
	key: required(nonEmptyString),
	summary: optional(nonEmptyString),
	type: optional(nonEmptyString),
	status: optional(nonEmptyString),
	priority: optional(nonEmptyString),
	assignee: optional(person),
	reporter: optional(nonEmptyString),
	estimate: optional(nonEmptyString),
	due: optional(nonEmptyString),
	labels: required(list(string)),
	created: optional(nonEmptyString),
	updated: optional(nonEmptyString),
	description: optional(nonEmptyString),
	url: optional(nonEmptyString),
	comments: required(list(comment)),
	transitions: required(list(transition)),
});

/** One Confluence page, as the panel draws it. */
const pagePanel = object<PagePanel>({
	kind: required(literal("page")),
	id: required(nonEmptyString),
	title: required(nonEmptyString),
	space: optional(nonEmptyString),
	url: optional(nonEmptyString),
	body: optional(nonEmptyString),
	comments: required(list(comment)),
});

/** A target a sidebar passes to the panel. */
const panelTarget = oneOf<PanelTarget>(
	object<Extract<PanelTarget, { kind: "issue" }>>({
		kind: required(literal("issue")),
		key: required(nonEmptyString),
	}),
	object<Extract<PanelTarget, { kind: "page" }>>({
		kind: required(literal("page")),
		id: required(nonEmptyString),
		title: optional(nonEmptyString),
	}),
);

/**
 * Narrow one response body to a panel target.
 * @param value - an opaque `params` bag from the sidebar.
 * @returns the target, or undefined when it is not one this version understands.
 */
export const asPanelTarget = panelTarget;

/**
 * Narrow one response body to a panel document.
 * @param value - the parsed JSON the host answered with.
 * @returns the document, or undefined when it is not one this version can draw.
 */
export const asPanelData = oneOf<PanelData>(issuePanel, pagePanel);

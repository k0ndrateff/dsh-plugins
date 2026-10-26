/**
 * Loading what the side panel shows.
 *
 * The panel is the second reader of the MCP connection: where a card wants a
 * summary, the panel wants the whole issue — description, comments, the
 * transitions the workflow offers right now — and it is the only place this
 * plugin writes to Atlassian at all (a status transition, an assignee).
 *
 * Every read is best-effort around the edges. A transition list that fails to
 * load, or a comment section the server declines, leaves the rest of the
 * document intact: a panel missing one section still answers the question the
 * user clicked on. What failed is carried in the document, so the panel can say
 * so instead of letting a missing section read as an empty one. Writes are the
 * opposite — a write that fails is reported, because silence there would look
 * like success.
 *
 * A write or a read may name its own site; the panel then works with that
 * site's cloud id rather than the selected default, so a card from site B never
 * opens site A's issue.
 */

import type { RuntimeState } from "dsh-integration-host";
import type { GrantStore, McpBridge } from "dsh-mcp-oauth";
import { asRecord, mcpJson, pickNumber, pickString } from "dsh-mcp-oauth";
import type {
	IssuePanel,
	PagePanel,
	PanelComment,
	PanelPerson,
	PanelTransition,
} from "../../shared/panel";
import { extractor, formatDuration } from "../presentation/extract";
import { type SiteFacts, siteFacts } from "../store/site";

/** How many comments to show on one panel. */
const COMMENT_LIMIT = 25;

/** How many people one lookup answers with. */
const PEOPLE_LIMIT = 8;

export interface PanelDeps {
	readonly bridge: McpBridge;
	readonly state: RuntimeState<SiteFacts>;
	/** Where a selected default site is remembered, when the host passes it. */
	readonly store?: Pick<GrantStore, "remember">;
}

/** One comment section, and what the server said about the whole thread. */
interface CommentSection {
	readonly comments: readonly PanelComment[];
	readonly total?: number;
	readonly truncated: boolean;
}

/** The outcome of the optional workflow read. */
type Workflow =
	| { readonly transitions: readonly PanelTransition[] }
	| { readonly error: string };

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export class PanelApi {
	constructor(private readonly deps: PanelDeps) {}

	/** The issue fields the panel renders. */
	private readonly ISSUE_FIELDS = [
		"summary",
		"description",
		"status",
		"issuetype",
		"priority",
		"assignee",
		"reporter",
		"created",
		"updated",
		"duedate",
		"labels",
		"resolution",
		"timetracking",
		"timeoriginalestimate",
	];

	/** Everything one issue panel shows, read from one site. */
	issue = async (key: string, cloudId?: string): Promise<IssuePanel> => {
		const site = this.site(cloudId);

		// The transitions are a second call, and one that may legitimately fail
		// (a workflow the token cannot read): the issue is what matters, and the
		// failure is carried along so the panel can say the list is missing.
		const [detail, workflow] = await Promise.all([
			this.deps.bridge.callTool("getJiraIssue", {
				cloudId: site.cloudId,
				issueIdOrKey: key,
				fields: [...this.ISSUE_FIELDS, "comment"],
				responseContentFormat: "markdown",
			}),
			this.deps.bridge
				.callTool("getTransitionsForJiraIssue", {
					cloudId: site.cloudId,
					issueIdOrKey: key,
				})
				.then(
					(value): Workflow => ({ transitions: this.transitionsOf(value) }),
					(error): Workflow => ({ error: messageOf(error) }),
				),
		]);

		const record = this.issueRecord(detail);
		if (record === undefined)
			throw new Error(`Atlassian returned no issue for ${key}`);

		const fields = asRecord(record.fields) ?? record;
		const identity = pickString(record, "key") ?? key;
		const summary = extractor.text(pickString(fields, "summary"));
		const comments = this.commentsOf(fields.comment);
		const url =
			site.url === undefined ? undefined : `${site.url}/browse/${identity}`;

		return {
			kind: "issue",
			key: identity,
			...(summary === undefined ? {} : { summary }),
			type: pickString(asRecord(fields.issuetype) ?? fields.issuetype, "name"),
			status: pickString(asRecord(fields.status) ?? fields.status, "name"),
			priority: pickString(
				asRecord(fields.priority) ?? fields.priority,
				"name",
			),
			assignee: this.personOf(fields.assignee),
			reporter: pickString(
				asRecord(fields.reporter) ?? fields.reporter,
				"displayName",
				"name",
			),
			estimate: this.estimateOf(fields),
			due: pickString(fields, "duedate"),
			labels: Array.isArray(fields.labels)
				? fields.labels.filter(
						(label): label is string => typeof label === "string",
					)
				: [],
			created: pickString(fields, "created"),
			updated: pickString(fields, "updated"),
			description: extractor.text(fields.description),
			...(url === undefined ? {} : { url }),
			comments: comments.comments,
			...(comments.total === undefined ? {} : { commentTotal: comments.total }),
			...(comments.truncated ? { commentsTruncated: true } : {}),
			transitions: "transitions" in workflow ? workflow.transitions : [],
			...("error" in workflow ? { transitionsError: workflow.error } : {}),
		};
	};

	/** Everything one page panel shows, read from one site. */
	page = async (id: string, cloudId?: string): Promise<PagePanel> => {
		const site = this.site(cloudId);

		const [detail, comments] = await Promise.all([
			this.deps.bridge.callTool("getConfluencePage", {
				cloudId: site.cloudId,
				pageId: id,
				contentFormat: "markdown",
			}),
			this.deps.bridge
				.callTool("getConfluencePageFooterComments", {
					cloudId: site.cloudId,
					pageId: id,
					limit: COMMENT_LIMIT,
				})
				.catch(() => undefined),
		]);

		const record = this.firstRecord(detail);
		if (record === undefined)
			throw new Error(`Atlassian returned no page for ${id}`);

		const title = pickString(record, "title") ?? id;
		const webui = pickString(asRecord(record._links), "webui");
		const url =
			webui === undefined
				? site.url === undefined
					? undefined
					: `${site.url}/wiki/pages/viewpage.action?pageId=${id}`
				: this.wikiUrl(webui, site.url);
		const thread = this.commentsOf(comments);

		return {
			kind: "page",
			id: pickString(record, "id") ?? id,
			title,
			space: pickString(asRecord(record.space) ?? record.space, "name", "key"),
			...(url === undefined ? {} : { url }),
			body: extractor.text(record.body),
			comments: thread.comments,
			...(thread.total === undefined ? {} : { commentTotal: thread.total }),
			...(thread.truncated ? { commentsTruncated: true } : {}),
		};
	};

	/** People the site matches to one search string. */
	people = async (query: string, cloudId?: string): Promise<PanelPerson[]> => {
		const value = await this.deps.bridge.callTool("lookupJiraAccountId", {
			cloudId: this.site(cloudId).cloudId,
			searchString: query,
			showAvatar: false,
		});

		const users = this.userList(value);

		return users
			.map((user) => ({
				name: pickString(user, "displayName") ?? "",
				accountId: pickString(user, "accountId", "account_id") ?? "",
			}))
			.filter((person) => person.name !== "" && person.accountId !== "")
			.slice(0, PEOPLE_LIMIT);
	};

	/**
	 * The signed-in user, as the site names them.
	 *
	 * `atlassianUserInfo` answers about the account the connection belongs to, in
	 * a shape of its own; the first record that carries an account id is the
	 * answer. A site that names none leaves the panel without a self-assignment
	 * rather than offering one Jira would refuse.
	 * @returns the reader, or undefined when the answer names no account.
	 */
	me = async (): Promise<PanelPerson | undefined> => {
		const value = await this.deps.bridge.callTool("atlassianUserInfo", {});

		return this.personIn(value);
	};

	/** Move one issue through a workflow transition. */
	transition = async (
		key: string,
		transitionId: string,
		cloudId?: string,
	): Promise<void> => {
		await this.deps.bridge.callTool("transitionJiraIssue", {
			cloudId: this.site(cloudId).cloudId,
			issueIdOrKey: key,
			transition: { id: transitionId },
		});
	};

	/** Set or clear one issue's assignee. */
	assign = async (
		key: string,
		accountId: string | null,
		cloudId?: string,
	): Promise<void> => {
		await this.deps.bridge.callTool("editJiraIssue", {
			cloudId: this.site(cloudId).cloudId,
			issueIdOrKey: key,
			fields: { assignee: accountId === null ? null : { accountId } },
		});
	};

	/**
	 * Make one of the account's sites the default.
	 *
	 * The selection is remembered beside the tokens, so it survives a restart
	 * without a new sign-in — the reason a multi-site account does not have to
	 * sign out to switch sites.
	 * @param cloudId - a site from the account's own list.
	 * @returns the facts as the rest of the plugin now sees them.
	 * @throws when no sites are known yet, or the id names none of them.
	 */
	selectSite = async (cloudId: string): Promise<SiteFacts> => {
		const current = this.deps.state.facts;

		if (current === undefined)
			throw new Error(
				"no Atlassian sites known yet — sign in, or run /atlassian sync",
			);

		const next = current.withSelection(cloudId);

		if (next === undefined)
			throw new Error(`unknown Atlassian site: ${cloudId}`);

		this.deps.state.facts = next;
		await this.deps.store?.remember(siteFacts.remember(next));

		return next;
	};

	/** The site one read or write works with. */
	private site = (
		cloudId: string | undefined,
	): { readonly cloudId: string; readonly url: string | undefined } => {
		const facts = this.deps.state.facts;

		if (cloudId !== undefined) return { cloudId, url: facts?.urlOf(cloudId) };

		if (facts?.cloudId === undefined)
			throw new Error(
				"no Atlassian site known yet — sign in from Settings or run /atlassian sync, then try again",
			);

		return { cloudId: facts.cloudId, url: facts.urlOf(undefined) };
	};

	/** Jira's own estimate words, or a duration rendered from raw seconds. */
	private estimateOf = (
		fields: Record<string, unknown>,
	): string | undefined => {
		const tracking = asRecord(fields.timetracking);
		const stated = pickString(
			tracking,
			"originalEstimate",
			"remainingEstimate",
		);

		if (stated !== undefined) return stated;

		const seconds = pickNumber(
			tracking,
			"originalEstimateSeconds",
			"remainingEstimateSeconds",
		);

		if (seconds !== undefined) return formatDuration(seconds);

		return formatDuration(
			pickNumber(fields, "timeoriginalestimate", "timeestimate") ?? 0,
		);
	};

	private personOf = (value: unknown): PanelPerson | undefined => {
		const record = asRecord(value);
		const accountId = pickString(record, "accountId", "account_id");
		const name = pickString(record, "displayName", "name");

		if (accountId === undefined || name === undefined) return undefined;

		return { accountId, name };
	};

	/** The Jira issue inside one `getJiraIssue` result. */
	private issueRecord = (value: unknown): Record<string, unknown> | undefined =>
		this.firstRecord(value, (record) => asRecord(record.fields) !== undefined);

	/** The first JSON record in a result, or the first one a predicate accepts. */
	private firstRecord = (
		value: unknown,
		accept: (record: Record<string, unknown>) => boolean = () => true,
	): Record<string, unknown> | undefined => {
		for (const root of mcpJson(value)) {
			const record = asRecord(root);
			if (record !== undefined && accept(record)) return record;

			if (!Array.isArray(root)) continue;

			for (const item of root) {
				const candidate = asRecord(item);
				if (candidate !== undefined && accept(candidate)) return candidate;
			}
		}

		return undefined;
	};

	/**
	 * The comment thread one issue or page carries.
	 *
	 * Jira nests it under the comment field as `{comments, total}`; Confluence
	 * answers with a page of `{results, total, _links}`. Both are read here, and
	 * the total is what lets the panel say "25 of 87" instead of passing a page
	 * of comments off as the whole thread.
	 */
	private commentsOf = (value: unknown): CommentSection => {
		// A page's comments arrive as a whole MCP result; an issue's arrive as
		// `fields.comment`, which is already the payload. Reading the JSON roots
		// first accepts both without the caller unwrapping one of them.
		const root = mcpJson(value)[0];
		const record = root === undefined ? asRecord(value) : asRecord(root);
		const list = Array.isArray(value)
			? value
			: Array.isArray(record?.comments)
				? (record?.comments as unknown[])
				: Array.isArray(record?.results)
					? (record?.results as unknown[])
					: [];

		const comments: PanelComment[] = [];

		for (const item of list) {
			const entry = asRecord(item);
			if (entry === undefined) continue;

			const body = extractor.text(entry.body);
			if (body === undefined) continue;

			const author = pickString(
				asRecord(entry.author) ?? entry.author,
				"displayName",
				"publicName",
				"name",
			);

			comments.push({
				body,
				...(author === undefined ? {} : { author }),
				...(pickString(entry, "created") === undefined
					? {}
					: { created: pickString(entry, "created") }),
			});

			if (comments.length >= COMMENT_LIMIT) break;
		}

		const total = pickNumber(record, "total");
		const hasNext = pickString(asRecord(record?._links), "next") !== undefined;

		return {
			comments,
			...(total === undefined ? {} : { total }),
			truncated:
				hasNext ||
				(total !== undefined && total > comments.length) ||
				(total === undefined && list.length >= COMMENT_LIMIT),
		};
	};

	/** The transitions a workflow currently offers. */
	private transitionsOf = (value: unknown): PanelTransition[] => {
		const record = this.firstRecord(value);
		const list = Array.isArray(record?.transitions) ? record.transitions : [];

		const transitions: PanelTransition[] = [];

		for (const item of list) {
			const candidate = asRecord(item);
			if (candidate === undefined) continue;

			const id = pickString(candidate, "id");
			const name = pickString(candidate, "name");
			if (id === undefined || name === undefined) continue;

			const to = asRecord(candidate.to);

			transitions.push({
				id,
				name,
				...(pickString(to, "name") === undefined
					? {}
					: { to: pickString(to, "name") }),
				// Jira omits `isAvailable` when the transition is offered.
				available: candidate.isAvailable !== false,
				needsFields: candidate.hasScreen === true,
			});
		}

		return transitions;
	};

	/** The user list inside one `lookupJiraAccountId` result. */
	private userList = (value: unknown): Record<string, unknown>[] => {
		for (const root of mcpJson(value)) {
			const users = asRecord(asRecord(asRecord(root)?.data)?.users);
			const list = users?.users;

			if (Array.isArray(list))
				return list
					.map((item) => asRecord(item))
					.filter(
						(item): item is Record<string, unknown> => item !== undefined,
					);
		}

		return [];
	};

	/** The first person named anywhere in one tool result. */
	private personIn = (value: unknown): PanelPerson | undefined => {
		for (const root of mcpJson(value)) {
			const person =
				this.personOf(root) ?? this.personOf(asRecord(asRecord(root)?.data));

			if (person !== undefined) return person;
		}

		return this.personOf(this.firstRecord(value));
	};

	/** A page's own path, resolved against the site's wiki. */
	private wikiUrl = (
		raw: string,
		siteUrl: string | undefined,
	): string | undefined => {
		if (raw.startsWith("http")) return raw;
		if (!raw.startsWith("/") || siteUrl === undefined) return undefined;

		return `${raw.startsWith("/wiki/") ? siteUrl : `${siteUrl}/wiki`}${raw}`;
	};
}

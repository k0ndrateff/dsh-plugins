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
 * user clicked on. Writes are the opposite — a write that fails is reported,
 * because silence there would look like success.
 */

import type { McpOAuthBridge } from "dsh-mcp-oauth";
import { asRecord, mcpJson, pickNumber, pickString } from "dsh-mcp-oauth";
import type {
	IssuePanel,
	PagePanel,
	PanelComment,
	PanelPerson,
	PanelTransition,
} from "../../shared/panel";
import { extractor, formatDuration } from "../presentation/extract";
import type { RuntimeState } from "../state";

/** How many comments to show on one panel. */
const COMMENT_LIMIT = 25;

/** How many people one lookup answers with. */
const PEOPLE_LIMIT = 8;

export interface PanelDeps {
	readonly bridge: McpOAuthBridge;
	readonly state: RuntimeState;
}

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

	/** Everything one issue panel shows. */
	issue = async (key: string): Promise<IssuePanel> => {
		const cloudId = this.cloudId();

		// The transitions are a second call, and one that may legitimately fail
		// (a workflow the token cannot read): the issue is what matters.
		const [detail, transitions] = await Promise.all([
			this.deps.bridge.callTool("getJiraIssue", {
				cloudId,
				issueIdOrKey: key,
				fields: [...this.ISSUE_FIELDS, "comment"],
				responseContentFormat: "markdown",
			}),
			this.deps.bridge
				.callTool("getTransitionsForJiraIssue", {
					cloudId,
					issueIdOrKey: key,
				})
				.then((value) => this.transitionsOf(value))
				.catch(() => [] as PanelTransition[]),
		]);

		const record = this.issueRecord(detail);
		if (record === undefined)
			throw new Error(`Atlassian returned no issue for ${key}`);

		const fields = asRecord(record.fields) ?? record;
		const identity = pickString(record, "key") ?? key;
		const summary = extractor.text(pickString(fields, "summary"));

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
			url:
				this.deps.state.siteUrl === undefined
					? undefined
					: `${this.deps.state.siteUrl}/browse/${identity}`,
			comments: this.commentsOf(fields.comment),
			transitions,
		};
	};

	/** Everything one page panel shows. */
	page = async (id: string): Promise<PagePanel> => {
		const cloudId = this.cloudId();

		const [detail, comments] = await Promise.all([
			this.deps.bridge.callTool("getConfluencePage", {
				cloudId,
				pageId: id,
				contentFormat: "markdown",
			}),
			this.deps.bridge
				.callTool("getConfluencePageFooterComments", {
					cloudId,
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

		return {
			kind: "page",
			id: pickString(record, "id") ?? id,
			title,
			space: pickString(asRecord(record.space) ?? record.space, "name", "key"),
			url:
				webui === undefined
					? this.deps.state.siteUrl === undefined
						? undefined
						: `${this.deps.state.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`
					: this.wikiUrl(webui, this.deps.state.siteUrl),
			body: extractor.text(record.body),
			comments: this.commentsOf(asRecord(comments)?.results),
		};
	};

	/** People the site matches to one search string. */
	people = async (query: string): Promise<PanelPerson[]> => {
		const value = await this.deps.bridge.callTool("lookupJiraAccountId", {
			cloudId: this.cloudId(),
			searchString: query,
			showAvatar: false,
		});

		const users = this.userList(value);

		return users
			.map((user) => ({
				name: pickString(user, "displayName") ?? "",
				accountId: pickString(user, "accountId") ?? "",
			}))
			.filter((person) => person.name !== "" && person.accountId !== "")
			.slice(0, PEOPLE_LIMIT);
	};

	/** Move one issue through a workflow transition. */
	transition = async (key: string, transitionId: string): Promise<void> => {
		await this.deps.bridge.callTool("transitionJiraIssue", {
			cloudId: this.cloudId(),
			issueIdOrKey: key,
			transition: { id: transitionId },
		});
	};

	/** Set or clear one issue's assignee. */
	assign = async (key: string, accountId: string | null): Promise<void> => {
		await this.deps.bridge.callTool("editJiraIssue", {
			cloudId: this.cloudId(),
			issueIdOrKey: key,
			fields: { assignee: accountId === null ? null : { accountId } },
		});
	};

	/** The connected site's cloud id, or a message the user can act on. */
	private cloudId = (): string => {
		if (this.deps.state.cloudId === undefined)
			throw new Error(
				"no Atlassian site known yet — sign in from Settings, then try again",
			);

		return this.deps.state.cloudId;
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
		const accountId = pickString(record, "accountId");
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

	/** The comment list one issue or page carries. */
	private commentsOf = (value: unknown): PanelComment[] => {
		const list = Array.isArray(value)
			? value
			: Array.isArray(asRecord(value)?.comments)
				? (asRecord(value)?.comments as unknown[])
				: [];

		const comments: PanelComment[] = [];

		for (const item of list) {
			const record = asRecord(item);
			if (record === undefined) continue;

			const body = extractor.text(record.body);
			if (body === undefined) continue;

			const author = pickString(
				asRecord(record.author) ?? record.author,
				"displayName",
				"publicName",
				"name",
			);

			comments.push({
				body,
				...(author === undefined ? {} : { author }),
				...(pickString(record, "created") === undefined
					? {}
					: { created: pickString(record, "created") }),
			});

			if (comments.length >= COMMENT_LIMIT) break;
		}

		return comments;
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

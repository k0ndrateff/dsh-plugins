/**
 * Turn one Atlassian MCP tool result into the card data the Web Client draws.
 *
 * Atlassian returns JSON payloads inside text content blocks and withholds
 * `structuredContent` (including `webUrl`) from clients it does not recognize by
 * name, so this walks whatever JSON it can find and recognizes Jira issues and
 * Confluence pages by their own fields. Anything unrecognized survives as a
 * bounded text excerpt, because the server's own words are always truthful.
 */

import type { AtlassianMeta, IssueCard, PageCard } from "../../shared/meta";

export interface ExtractOptions {
	/** The server's own tool name. */
	readonly tool: string;
	/** The arguments the model supplied. */
	readonly args: unknown;
	/** The canonical MCP value the tool returned. */
	readonly value: unknown;
	/** Atlassian site base URL, when the plugin has learned it. */
	readonly siteUrl: string | undefined;
}

class Extractor {
	/** Jira issue keys: an uppercase project key, a dash, and a number. */
	// @ts-expect-error
	private readonly ISSUE_KEY = /\b[A-Z][A-Z0-9_]{0,9}-\d+\b/u;

	/** Bound the work a pathological payload can cause. */
	private readonly MAX_OBJECTS = 3000;
	private readonly MAX_STRINGS = 800;
	private readonly MAX_DEPTH = 7;
	private readonly MAX_CARDS = 25;
	private readonly MAX_TEXT = 4000;

	/**
	 * Extract card data from one tool result.
	 * @param options - the tool name, its arguments, and the returned value.
	 * @returns the meta the client renders; `text` is always populated.
	 */
	extract = (options: ExtractOptions): AtlassianMeta => {
		const texts = this.textBlocks(options.value);
		const joined = texts.join("\n").trim();

		const roots: unknown[] = [];
		const structured = this.asRecord(options.value)?.structuredContent;

		if (structured !== undefined) roots.push(structured);

		for (const text of texts) {
			const trimmed = text.trim();

			if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
			try {
				roots.push(JSON.parse(trimmed));
			} catch {
				// Not JSON; the text excerpt still carries the answer.
			}
		}

		const objects: Record<string, unknown>[] = [];
		const strings: string[] = [];

		for (const root of roots) {
			this.collectObjects(root, objects, 0);
			this.collectStrings(root, strings, 0);
		}

		// Links often live outside the JSON payload: markdown rows, plain prose.
		this.collectStrings(joined, strings, 0);

		const issues = this.issueCards(objects, strings, options.siteUrl);
		const pages =
			issues.length > 0
				? []
				: this.pageCards(objects, strings, options.siteUrl);
		const query = this.pick(
			options.args,
			"jql",
			"cql",
			"query",
			"searchString",
			"issueIdOrKey",
			"pageId",
			"cloudId",
		);

		return {
			kind:
				issues.length > 0
					? "jira-issues"
					: pages.length > 0
						? "confluence-pages"
						: "text",
			tool: options.tool,
			...(query === undefined ? {} : { query }),
			issues,
			pages,
			text: joined.slice(0, this.MAX_TEXT),
		};
	};

	/** Text content blocks of an MCP result, in order. */
	private textBlocks = (value: unknown): string[] => {
		if (value === null || typeof value !== "object") return [];

		const content = (value as { content?: unknown }).content;

		if (!Array.isArray(content)) return [];

		const out: string[] = [];
		for (const block of content) {
			if (block !== null && typeof block === "object") {
				const { type, text } = block as { type?: unknown; text?: unknown };

				if (type === "text" && typeof text === "string") out.push(text);
			}
		}

		return out;
	};

	private collectStrings = (
		node: unknown,
		out: string[],
		depth: number,
	): void => {
		if (
			depth > this.MAX_DEPTH ||
			node === null ||
			node === undefined ||
			out.length >= this.MAX_STRINGS
		)
			return;

		if (typeof node === "string") {
			out.push(node);
			return;
		}

		if (Array.isArray(node)) {
			for (const item of node) this.collectStrings(item, out, depth + 1);

			return;
		}

		if (typeof node === "object") {
			for (const item of Object.values(node))
				this.collectStrings(item, out, depth + 1);
		}
	};

	private collectObjects = (
		node: unknown,
		out: Record<string, unknown>[],
		depth: number,
	): void => {
		if (
			depth > this.MAX_DEPTH ||
			node === null ||
			node === undefined ||
			out.length >= this.MAX_OBJECTS
		)
			return;

		if (Array.isArray(node)) {
			for (const item of node) this.collectObjects(item, out, depth + 1);

			return;
		}

		if (typeof node !== "object") return;
		out.push(node as Record<string, unknown>);

		for (const item of Object.values(node))
			this.collectObjects(item, out, depth + 1);
	};

	/** The first non-empty string among the named fields. */
	private pick = (source: unknown, ...names: string[]): string | undefined => {
		if (source === null || source === undefined || typeof source !== "object")
			return undefined;

		const record = source as Record<string, unknown>;

		for (const name of names) {
			const value = record[name];

			if (typeof value === "string" && value.trim() !== "") return value.trim();
			if (typeof value === "number") return String(value);
		}

		return undefined;
	};

	private asRecord = (value: unknown): Record<string, unknown> | undefined => {
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	};

	private compact = <T extends object>(value: T): T => {
		return Object.fromEntries(
			Object.entries(value).filter(
				([, item]) => item !== undefined && item !== "",
			),
		) as T;
	};

	/** The first absolute `/browse/<key>` URL in the payload, else the site's own. */
	private issueUrl = (
		strings: readonly string[],
		key: string,
		siteUrl: string | undefined,
	): string | undefined => {
		for (const text of strings) {
			if (!text.includes("/browse/") || !text.includes(key)) continue;

			const match = text.match(
				// @ts-expect-error
				/https?:\/\/[^\s"')<>]*\/browse\/[A-Z][A-Z0-9_]{0,9}-\d+/u,
			);

			if (match !== null) return match[0];
		}

		return siteUrl === undefined ? undefined : `${siteUrl}/browse/${key}`;
	};

	/** Resolve a possibly relative Atlassian path against the site the payload names. */
	private absoluteUrl = (
		raw: string | undefined,
		strings: readonly string[],
	): string | undefined => {
		if (raw === undefined) return undefined;

		if (raw.startsWith("http")) return raw;
		if (!raw.startsWith("/")) return undefined;

		for (const text of strings) {
			// @ts-expect-error
			const match = text.match(/https?:\/\/[^\s"')<>]*atlassian\.net/u);

			if (match !== null) return `${match[0]}${raw}`;
		}

		return undefined;
	};

	private issueCards = (
		objects: readonly Record<string, unknown>[],
		strings: readonly string[],
		siteUrl: string | undefined,
	): IssueCard[] => {
		const issues = new Map<string, IssueCard>();

		for (const node of objects) {
			const key = this.pick(node, "key");

			if (key === undefined || !this.ISSUE_KEY.test(key) || issues.has(key))
				continue;

			// A Jira REST issue nests its fields; an Atlassian MCP payload may not.
			const fields = this.asRecord(node.fields) ?? node;

			issues.set(
				key,
				this.compact({
					key,
					summary: this.pick(fields, "summary", "name", "title"),
					status:
						this.pick(this.asRecord(fields.status) ?? fields.status, "name") ??
						this.pick(fields, "status"),
					assignee:
						this.pick(
							this.asRecord(fields.assignee) ?? fields.assignee,
							"displayName",
							"name",
						) ?? this.pick(fields, "assignee"),
					priority:
						this.pick(
							this.asRecord(fields.priority) ?? fields.priority,
							"name",
						) ?? this.pick(fields, "priority"),
					type:
						this.pick(
							this.asRecord(fields.issuetype) ?? fields.issuetype,
							"name",
						) ?? this.pick(fields, "issuetype"),
					url: this.issueUrl(strings, key, siteUrl),
				}),
			);

			if (issues.size >= this.MAX_CARDS) break;
		}

		// @ts-expect-error
		return [...issues.values()];
	};

	private pageCards = (
		objects: readonly Record<string, unknown>[],
		strings: readonly string[],
		siteUrl: string | undefined,
	): PageCard[] => {
		const pages = new Map<string, PageCard>();

		for (const node of objects) {
			const title = this.pick(node, "title");

			if (title === undefined) continue;

			const id = this.pick(node, "id");
			const raw =
				this.pick(node, "url") ??
				this.pick(this.asRecord(node._links), "webui", "base");

			if (id === undefined && raw === undefined) continue;

			const identity = raw ?? id ?? title;

			if (pages.has(identity)) continue;

			const url =
				this.absoluteUrl(raw, strings) ??
				(id !== undefined && siteUrl !== undefined
					? `${siteUrl}/wiki/pages/${id}`
					: undefined);

			pages.set(
				identity,
				this.compact({
					id,
					title,
					url,
					space: this.pick(
						this.asRecord(node.space) ?? node.space,
						"name",
						"key",
					),
				}),
			);
			if (pages.size >= this.MAX_CARDS) break;
		}

		// @ts-expect-error
		return [...pages.values()];
	};
}

export const extractor = new Extractor();

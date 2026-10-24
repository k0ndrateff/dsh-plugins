/**
 * Turn one Atlassian MCP tool result into the card data the Web Client draws.
 *
 * Atlassian returns JSON payloads inside text content blocks and withholds
 * `structuredContent` (including `webUrl`) from clients it does not recognize by
 * name, so this walks whatever JSON it can find and recognizes Jira issues and
 * Confluence pages by their own fields. Anything unrecognized survives as a
 * bounded text excerpt, because the server's own words are always truthful.
 */

import { stripHtmlComments } from "dsh-integration-host";
import { mcpJson, mcpText } from "dsh-mcp-oauth";
import type {
	AtlassianMeta,
	IssueCard,
	MetaKind,
	PageCard,
} from "../../shared/meta";

export interface ExtractOptions {
	/** The server's own tool name. */
	readonly tool: string;
	/** The arguments the model supplied. */
	readonly args: unknown;
	/** The canonical MCP value the tool returned. */
	readonly value: unknown;
	/** Atlassian site base URL, when the plugin has learned it. */
	readonly siteUrl: string | undefined;
	/**
	 * Also carry each item's long text.
	 *
	 * Off by default: the recorded card is a summary, and a description belongs
	 * in the session log only after it has been compressed. A caller that asks
	 * for it reads `rawText` and projects the card again without it.
	 */
	readonly bodies?: boolean;
}

/** Minutes in the eight-hour day Jira estimates are quoted in. */
const MINUTES_PER_DAY = 480;

/**
 * Render a duration in seconds the way Jira quotes estimates.
 * @param seconds - a raw `timeoriginalestimate`, or the equivalent.
 * @returns a compact "3d 4h" style string, or undefined for nothing usable.
 */
export function formatDuration(seconds: number): string | undefined {
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

	const total = Math.round(seconds / 60);
	if (total < 1) return "<1m";

	const days = Math.floor(total / MINUTES_PER_DAY);
	const hours = Math.floor((total - days * MINUTES_PER_DAY) / 60);
	const minutes = total - days * MINUTES_PER_DAY - hours * 60;

	// Minutes are dropped once the estimate reaches a day: "3d 4h 12m" claims a
	// precision nobody plans with.
	const parts = [
		days === 0 ? "" : `${days}d`,
		hours === 0 ? "" : `${hours}h`,
		minutes === 0 || days > 0 ? "" : `${minutes}m`,
	];

	return parts.filter(Boolean).join(" ");
}

class Extractor {
	/** Jira issue keys: an uppercase project key, a dash, and a number. */
	private readonly ISSUE_KEY = /\b[A-Z][A-Z0-9_]{0,9}-\d+\b/u;

	/** Bound the work a pathological payload can cause. */
	private readonly MAX_OBJECTS = 3000;
	private readonly MAX_STRINGS = 800;
	private readonly MAX_DEPTH = 7;
	private readonly MAX_CARDS = 25;
	/** Longest description or body kept for a summary pass or a panel. */
	private readonly MAX_BODY = 8000;

	/** Node types that end a line, so a flattened document keeps its shape. */
	private readonly BLOCK_TYPES = new Set([
		"paragraph",
		"heading",
		"blockquote",
		"codeBlock",
		"listItem",
		"tableRow",
		"panel",
		"rule",
	]);

	/**
	 * Extract card data from one tool result.
	 * @param options - the tool name, its arguments, and the returned value.
	 * @returns the meta the client renders.
	 */
	extract = (options: ExtractOptions): AtlassianMeta => {
		const texts = mcpText(options.value);
		const joined = texts.join("\n").trim();

		const roots: unknown[] = [];
		const structured = this.asRecord(options.value)?.structuredContent;

		if (structured !== undefined) roots.push(structured);

		roots.push(...mcpJson(options.value));

		const objects: Record<string, unknown>[] = [];
		const strings: string[] = [];

		for (const root of roots) {
			this.collectObjects(root, objects, 0);
			this.collectStrings(root, strings, 0);
		}

		// Links often live outside the JSON payload: markdown rows, plain prose.
		this.collectStrings(joined, strings, 0);

		const issues = this.issueCards(
			objects,
			strings,
			options.siteUrl,
			options.bodies === true,
		);
		const pages =
			issues.length > 0
				? []
				: this.pageCards(
						objects,
						strings,
						options.siteUrl,
						options.bodies === true,
					);
		const query = this.pick(
			options.args,
			"jql",
			"cql",
			"query",
			"searchString",
			"issueIdOrKey",
			"pageId",
		);

		const kind: MetaKind =
			issues.length > 0
				? "jira-issues"
				: pages.length > 0
					? "confluence-pages"
					: "text";

		// A total only means something next to items it counts.
		const total = kind === "text" ? undefined : this.totalOf(roots);

		return {
			kind,
			tool: options.tool,
			...(query === undefined ? {} : { query }),
			...(total === undefined ? {} : { total }),
			issues,
			pages,
		};
	};

	/**
	 * Flatten one rich field to the plain text a caller can use.
	 *
	 * The side panel reads a description or a comment body through this: the same
	 * markdown-or-ADF handling the cards use, with the same bound.
	 * @param value - a markdown string, an ADF tree, or anything else.
	 * @returns the text, or undefined when there is none.
	 */
	text = (value: unknown): string | undefined => this.plainText(value);

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

	/** The first finite number among the named fields. */
	private numberOf = (
		source: unknown,
		...names: string[]
	): number | undefined => {
		if (source === null || source === undefined || typeof source !== "object")
			return undefined;

		const record = source as Record<string, unknown>;

		for (const name of names) {
			const value = record[name];

			if (typeof value === "number" && Number.isFinite(value)) return value;

			// A JSON payload may quote a count; a string that is not a number is
			// not a count.
			if (typeof value === "string" && value.trim() !== "") {
				const parsed = Number(value);

				if (Number.isFinite(parsed)) return parsed;
			}
		}

		return undefined;
	};

	/**
	 * How many items the server says matched, when a root record reports it.
	 *
	 * Only the roots are read, never the hundreds of nested objects: `total` is
	 * a page-level fact, and a nested one belongs to something else.
	 */
	private totalOf = (roots: readonly unknown[]): number | undefined => {
		let total: number | undefined;

		const raise = (candidate: number | undefined): void => {
			if (candidate === undefined) return;
			total = total === undefined ? candidate : Math.max(total, candidate);
		};

		for (const root of roots) {
			if (Array.isArray(root)) {
				raise(root.length);

				continue;
			}

			raise(
				this.numberOf(this.asRecord(root), "total", "totalCount", "totalSize"),
			);
		}

		return total;
	};

	/** A duration estimate, in Jira's own words when it gave them. */
	private estimateOf = (
		fields: Record<string, unknown>,
	): string | undefined => {
		const tracking =
			this.asRecord(fields.timetracking) ?? this.asRecord(fields.timeTracking);

		const stated = this.pick(tracking, "originalEstimate", "remainingEstimate");

		if (stated !== undefined) return stated;

		const seconds = this.numberOf(
			tracking,
			"originalEstimateSeconds",
			"remainingEstimateSeconds",
		);

		if (seconds !== undefined) return formatDuration(seconds);

		return formatDuration(
			this.numberOf(
				fields,
				"timeoriginalestimate",
				"aggregateoriginalestimate",
				"timeestimate",
				"aggregatetimeestimate",
			) ?? 0,
		);
	};

	/**
	 * The plain text of a rich field.
	 *
	 * A description arrives as markdown text from one server generation and as
	 * an Atlassian Document Format tree from the other, so this reads both: text
	 * nodes in order, with a break between the blocks that carry one.
	 */
	private plainText = (value: unknown): string | undefined => {
		// A markdown field is where a provider's own notes-to-editors hide; the ADF
		// branch below carries text nodes, which have no comments to remove.
		if (typeof value === "string") return this.tidy(stripHtmlComments(value));

		const text = this.tidy(this.richText(value, 0));

		return text === "" ? undefined : text;
	};

	/**
	 * The plain text of a search snippet.
	 *
	 * A Confluence search result carries an `excerpt` that is not a document but
	 * a fragment of rendered HTML, entities and all.
	 */
	private snippetText = (value: unknown): string | undefined => {
		if (typeof value !== "string") return this.plainText(value);

		const stripped = value
			.replace(/<[^>]*>/gu, " ")
			.replace(/&lt;/gu, "<")
			.replace(/&gt;/gu, ">")
			.replace(/&quot;/gu, '"')
			.replace(/&#39;/gu, "'")
			.replace(/&nbsp;/gu, " ")
			.replace(/&amp;/gu, "&");

		return this.plainText(stripped);
	};

	private richText = (node: unknown, depth: number): string => {
		if (depth > this.MAX_DEPTH || node === null || node === undefined)
			return "";

		if (typeof node === "string") return node;
		if (typeof node === "number" || typeof node === "boolean")
			return ` ${String(node)} `;

		if (Array.isArray(node))
			return node.map((item) => this.richText(item, depth + 1)).join("");

		if (typeof node !== "object") return "";

		const record = node as Record<string, unknown>;

		const body =
			typeof record.text === "string"
				? record.text
				: record.content === undefined
					? ""
					: this.richText(record.content, depth + 1);

		return this.BLOCK_TYPES.has(String(record.type)) ? `${body}\n\n` : body;
	};

	/** Collapse the whitespace a markdown or ADF body is full of. */
	private tidy = (value: string): string => {
		const fences: string[] = [];
		const protectedText = value.replace(/(```|~~~)[\s\S]*?\1/gu, (block) => {
			fences.push(block);

			return `\uE000${fences.length - 1}\uE000`;
		});

		const tidied = protectedText
			.replace(/\r\n?/gu, "\n")
			.replace(/[^\S\n]+/gu, " ")
			.replace(/\n{3,}/gu, "\n\n")
			.trim()
			.slice(0, this.MAX_BODY);

		return tidied.replace(
			/\uE000(\d+)\uE000/gu,
			(_placeholder, index: string) => fences[Number(index)] ?? "",
		);
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
				/https?:\/\/[^\s"')<>]*\/browse\/[A-Z][A-Z0-9_]{0,9}-\d+/u,
			);

			if (match !== null) return match[0];
		}

		return siteUrl === undefined ? undefined : `${siteUrl}/browse/${key}`;
	};

	/**
	 * Resolve a possibly relative Atlassian path against the site's own root.
	 *
	 * A Confluence search answers with `"/spaces/KEY/pages/123/Title"`, which is
	 * relative to the wiki (`https://site.atlassian.net/wiki`), while a `webui`
	 * link that already starts with `/wiki` is relative to the site itself. The
	 * payload's own absolute URLs say which site that is; the learned site is
	 * the fallback when the payload never spells one out.
	 */
	private absoluteUrl = (
		raw: string | undefined,
		strings: readonly string[],
		siteUrl: string | undefined,
	): string | undefined => {
		if (raw === undefined) return undefined;

		if (raw.startsWith("http")) return raw;
		if (!raw.startsWith("/")) return undefined;

		const site = this.siteBase(strings) ?? siteUrl;
		if (site === undefined) return undefined;

		return `${raw.startsWith("/wiki/") ? site : `${site}/wiki`}${raw}`;
	};

	/** The first `https://<site>.atlassian.net` the payload spells out. */
	private siteBase = (strings: readonly string[]): string | undefined => {
		for (const text of strings) {
			const match = text.match(/https?:\/\/[^\s"')<>]*atlassian\.net/u);

			if (match !== null) return match[0];
		}

		return undefined;
	};

	private issueCards = (
		objects: readonly Record<string, unknown>[],
		strings: readonly string[],
		siteUrl: string | undefined,
		bodies: boolean,
	): IssueCard[] => {
		const issues = new Map<string, IssueCard>();

		for (const node of objects) {
			const key = this.pick(node, "key");

			if (key === undefined || !this.ISSUE_KEY.test(key) || issues.has(key))
				continue;

			// A Jira REST issue nests its fields; an Atlassian MCP payload may not.
			const fields = this.asRecord(node.fields) ?? node;
			const rawText = bodies ? this.plainText(fields.description) : undefined;

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
					estimate: this.estimateOf(fields),
					url: this.issueUrl(strings, key, siteUrl),
					rawText,
				}),
			);

			if (issues.size >= this.MAX_CARDS) break;
		}

		return [...issues.values()];
	};

	private pageCards = (
		objects: readonly Record<string, unknown>[],
		strings: readonly string[],
		siteUrl: string | undefined,
		bodies: boolean,
	): PageCard[] => {
		const pages = new Map<string, PageCard>();

		for (const node of objects) {
			const title = this.pick(node, "title");

			if (title === undefined) continue;

			const id = this.pick(node, "id");
			// `_links.webui` is the canonical page path; `_links.base` is the
			// site's own root, which is not where a title should lead.
			const raw =
				this.pick(node, "url") ??
				this.pick(this.asRecord(node._links), "webui");

			if (id === undefined && raw === undefined) continue;

			const identity = raw ?? id ?? title;

			if (pages.has(identity)) continue;

			const url =
				this.absoluteUrl(raw, strings, siteUrl) ??
				(id !== undefined && siteUrl !== undefined
					? `${siteUrl}/wiki/pages/viewpage.action?pageId=${id}`
					: undefined);

			// A full page carries its body; a search result carries only an
			// HTML-ish snippet. Either is enough for the one sentence shown.
			const rawText = !bodies
				? undefined
				: node.body === undefined
					? this.snippetText(node.excerpt)
					: this.plainText(node.body);

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
					rawText,
				}),
			);
			if (pages.size >= this.MAX_CARDS) break;
		}

		return [...pages.values()];
	};
}

export const extractor = new Extractor();

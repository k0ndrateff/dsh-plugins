/**
 * The wire contract between the two halves.
 *
 * The host half turns one MCP tool result into this shape and hands it to the
 * tool pipeline as `presentationMeta`; the harness persists it on the tool
 * result and the Web Client reads it back as `meta`. Both halves import these
 * types, and each bundle inlines its own copy — a type-only contract, not
 * shared runtime state.
 */

/** A Jira issue, reduced to what a card shows. */
export type IssueCard = {
	readonly key: string;
	readonly summary?: string;
	readonly status?: string;
	readonly assignee?: string;
	readonly priority?: string;
	readonly type?: string;
	readonly url?: string;
};

/** A Confluence page (or any titled content), reduced to what a card shows. */
export type PageCard = {
	readonly id?: string;
	readonly title: string;
	readonly url?: string;
	readonly space?: string;
};

/** The kinds of result the host half recognizes. */
export type MetaKind = "jira-issues" | "confluence-pages" | "text";

/**
 * What the host half publishes for one Atlassian tool result.
 *
 * `text` is always present so a card can fall back to the server's own words
 * even when nothing was recognized.
 */
export type AtlassianMeta = {
	readonly kind: MetaKind;
	/** The server's own tool name, before the `mcp__atlassian__` prefix. */
	readonly tool: string;
	/** The query or target the call carried, when it had one. */
	readonly query?: string;
	issues: IssueCard[];
	pages: PageCard[];
	readonly text: string;
};

/** Narrow an unknown `meta` value from the wire to this contract. */
export function asAtlassianMeta(value: unknown): AtlassianMeta | undefined {
	if (value === null || typeof value !== "object") return undefined;

	const candidate = value as Partial<AtlassianMeta>;
	if (typeof candidate.kind !== "string" || typeof candidate.tool !== "string")
		return undefined;

	return {
		kind:
			candidate.kind === "jira-issues" || candidate.kind === "confluence-pages"
				? candidate.kind
				: "text",
		tool: candidate.tool,
		...(typeof candidate.query === "string" ? { query: candidate.query } : {}),
		issues: Array.isArray(candidate.issues)
			? (candidate.issues as IssueCard[])
			: [],
		pages: Array.isArray(candidate.pages)
			? (candidate.pages as PageCard[])
			: [],
		text: typeof candidate.text === "string" ? candidate.text : "",
	};
}

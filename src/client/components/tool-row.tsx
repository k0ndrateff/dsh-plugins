/**
 * The Atlassian tool row.
 *
 * Claiming a tool name in the `tool.call.toolview` slot replaces the generic
 * row for **every** shape of that call — preparing, running, failed, replayed —
 * so this component owns all of them and degrades to the server's own text
 * whenever the card data is missing or unexpected.
 *
 * The card data is what the host half published as `presentationMeta` and the
 * harness persisted on the tool result; it arrives here as `block.meta`.
 */

import { StateDot, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { asAtlassianMeta } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { Badge } from "./badge";
import { IssueItem } from "./issue-item";
import { PageItem } from "./page-item";

/** The block shapes this row may be handed, narrowed to what it reads. */
interface ToolRowBlock {
	name?: string;
	argsRaw?: unknown;
	rawInput?: unknown;
	content?: readonly {
		type?: string;
		text?: string;
	}[];
	isError?: boolean;
	error?: unknown;
	meta?: unknown;
}

/** The server's own words: the text blocks of a tool result, in order. */
const getResultText = (block: ToolRowBlock | undefined): string => {
	const blocks = block?.content ?? [];

	return blocks
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();
};

const formatArguments = (block: ToolRowBlock | undefined): string => {
	const raw = block?.argsRaw ?? block?.rawInput;

	if (raw === undefined || raw === null || raw === "") return "";

	return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
};

const formatAsText = (value: unknown): string => {
	if (value === null || value === undefined) return "";

	return typeof value === "string" ? value : JSON.stringify(value);
};

interface Props {
	phase?: string;
	block?: ToolRowBlock;
	toolName?: string;
}

/** One Atlassian tool call, as a card. */
export const AtlassianToolRow = ({ phase, block, toolName }: Props) => {
	const serverTool = asAtlassianMeta(block?.meta)?.tool ?? toolName ?? "";
	const meta = asAtlassianMeta(block?.meta);

	const header = (
		<div className={styles.head}>
			<span className={styles.title}>Atlassian</span>

			<span className={styles.badges}>
				<Tag tone="neutral">{serverTool}</Tag>

				<Badge label="Query" value={meta?.query} />
			</span>
		</div>
	);

	if (phase !== "result") {
		const args = formatArguments(block);

		return (
			<div className={styles.card} data-tool={toolName}>
				{header}

				{args === "" ? null : <pre className={styles.code}>{args}</pre>}
			</div>
		);
	}

	if (block?.isError === true) {
		return (
			<div className={styles.card} data-tool={toolName}>
				{header}

				<div className={styles.row}>
					<StateDot state="error" />

					<span className={styles.caption}>
						The Atlassian host half is not reachable.
					</span>
				</div>

				<pre className={`${styles.code} ${styles.error}`}>
					{getResultText(block) || formatAsText(block.error)}
				</pre>
			</div>
		);
	}

	if (meta !== undefined && meta.issues.length > 0) {
		return (
			<div className={styles.card} data-tool={toolName}>
				{header}

				<ul className={styles.list}>
					{meta.issues.map((issue) => (
						<IssueItem key={issue.key} issue={issue} />
					))}
				</ul>
			</div>
		);
	}

	if (meta !== undefined && meta.pages.length > 0) {
		return (
			<div className={styles.card} data-tool={toolName}>
				{header}

				<ul className={styles.list}>
					{meta.pages.map((page, index) => (
						<PageItem key={page.id ?? index} page={page} />
					))}
				</ul>
			</div>
		);
	}

	const text =
		meta?.text !== undefined && meta.text !== ""
			? meta.text
			: getResultText(block);

	return (
		<div className={styles.card} data-tool={toolName}>
			{header}

			{text === "" ? null : <pre className={styles.code}>{text}</pre>}
		</div>
	);
};

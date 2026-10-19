/**
 * The Atlassian tool row: one line about what the call did.
 *
 * Claiming a tool name in the `tool.call.toolview` slot replaces the generic row
 * for **every** shape of that call — preparing, running, failed, replayed — so
 * this component owns all of them.
 *
 * It stays deliberately terse. The server's payload is large JSON, and a tool
 * group that reproduces it buries the answer; the cards belong to
 * `atlassian_present`, which puts them where the user is actually reading. What
 * this row adds is the count and the query the call resolved.
 */

import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { asAtlassianMeta } from "../../shared/meta";
import * as styles from "../styles/styles.css";

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

/** The server's own words, as a last resort. */
const getResultText = (block: ToolRowBlock | undefined): string => {
	const blocks = block?.content ?? [];

	return blocks
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();
};

/** The server's tool name, without this plugin's namespace. */
const serverToolName = (toolName: string | undefined): string =>
	(toolName ?? "").replace(/^mcp__atlassian__/u, "") || "Atlassian";

/** One short phrase describing what a settled call found. */
const summarize = (
	block: ToolRowBlock | undefined,
	toolName: string | undefined,
): string => {
	const meta = asAtlassianMeta(block?.meta);
	if (meta === undefined) return "done";

	const parts: string[] = [];

	if (meta.issues.length > 0)
		parts.push(
			`found ${meta.issues.length} issue${meta.issues.length === 1 ? "" : "s"}`,
		);
	else if (meta.pages.length > 0)
		parts.push(
			`found ${meta.pages.length} page${meta.pages.length === 1 ? "" : "s"}`,
		);

	if (meta.query !== undefined) parts.push(meta.query);
	if (parts.length === 0) parts.push("done");

	return parts.join(" · ");
};

interface Props {
	phase?: string;
	block?: ToolRowBlock;
	toolName?: string;
}

/** One Atlassian tool call, as a single line. */
export const AtlassianToolRow = ({ phase, block, toolName }: Props) => {
	const name = serverToolName(toolName);

	if (phase !== "result") {
		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="ongoing" />
				<span className={styles.toolName}>{name}</span>
			</div>
		);
	}

	if (block?.isError === true) {
		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="error" />
				<span className={styles.toolName}>{name}</span>
				<span className={`${styles.caption} ${styles.error}`}>
					{getResultText(block) || "failed"}
				</span>
			</div>
		);
	}

	return (
		<div className={styles.toolRow} data-tool={toolName}>
			<StateDot state="done" />
			<span className={styles.toolName}>{name}</span>
			<span className={styles.caption}>{summarize(block, toolName)}</span>
		</div>
	);
};

/**
 * The Sentry tool row: one line about what the call did.
 *
 * Claiming `sentry_present` in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — so this
 * component owns all of them.
 *
 * It stays deliberately terse. The issues belong to the card under the answer,
 * and a tool group that reproduces them buries the answer; what this row adds is
 * the count and the query the call resolved.
 */

import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { asSentryPresentation } from "../../shared/meta";
import { SENTRY_TOOL_NAME } from "../conversation/card-definition";
import * as styles from "../styles/styles.css";

/** The block shapes this row may be handed, narrowed to what it reads. */
interface ToolRowBlock {
	argsRaw?: unknown;
	call?: { argsRaw?: unknown } | null;
	meta?: unknown;
	isError?: boolean;
	content?: readonly { type?: string; text?: string }[];
}

/** The server's own words, as a last resort for a failed call. */
const resultText = (block: ToolRowBlock | undefined): string =>
	(block?.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();

/** The first issue id of a preparing call's arguments, when it named any. */
const firstIssue = (value: unknown): string | undefined => {
	if (!Array.isArray(value)) return undefined;

	return value.find((id): id is string => typeof id === "string" && id !== "");
};

/** The query or the first issue id the call asked for, from its arguments. */
const askedFor = (block: ToolRowBlock | undefined): string | undefined => {
	for (const raw of [block?.argsRaw, block?.call?.argsRaw]) {
		if (typeof raw !== "string" || raw === "") continue;

		try {
			const parsed = JSON.parse(raw) as { query?: unknown; issues?: unknown };

			if (typeof parsed.query === "string" && parsed.query !== "")
				return parsed.query;

			const issue = firstIssue(parsed.issues);
			if (issue !== undefined) return issue;
		} catch {
			// A preparing call can hold half-written JSON; the arguments are optional.
		}
	}

	return undefined;
};

/** One short phrase describing what a settled call found. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const card = asSentryPresentation(block?.meta);
	if (card === undefined) return "done";

	const count = card.issues.length;
	const parts = [`${count} issue${count === 1 ? "" : "s"}`];

	if (card.query !== undefined) parts.push(card.query);

	return parts.join(" · ");
};

interface Props {
	phase?: string;
	block?: ToolRowBlock;
	toolName?: string;
}

/** One `sentry_present` call, as a single line. */
export const SentryToolRow = ({ phase, block, toolName }: Props) => {
	if (phase !== "result") {
		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="ongoing" />
				<span className={styles.toolName}>{SENTRY_TOOL_NAME}</span>
				<span className={styles.caption}>{askedFor(block) ?? "…"}</span>
			</div>
		);
	}

	if (block?.isError === true) {
		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="error" />
				<span className={styles.toolName}>{SENTRY_TOOL_NAME}</span>
				<span className={`${styles.caption} ${styles.error}`}>
					{resultText(block) || "failed"}
				</span>
			</div>
		);
	}

	return (
		<div className={styles.toolRow} data-tool={toolName}>
			<StateDot state="done" />
			<span className={styles.toolName}>{SENTRY_TOOL_NAME}</span>
			<span className={styles.caption}>{summarize(block)}</span>
		</div>
	);
};

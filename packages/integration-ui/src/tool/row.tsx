/**
 * The terse tool row one integration's calls render as.
 *
 * Claiming a tool name in the `tool.call.toolview` slot replaces the generic row
 * for **every** shape of that call — preparing, running, failed, replayed — so
 * this component owns all of them.
 *
 * It stays deliberately terse. The server's payload is large, and a tool group
 * that reproduces it buries the answer; the cards belong to the integration's
 * own `present` tool, which puts them where the user is actually reading. What
 * this row adds is a human label, the count, and the query the call resolved.
 *
 * The label is the integration's own words rather than the wire name: a reader
 * watching the work wants "Project checks", not `checks`. The wire name stays on
 * the row as its tooltip, which is where somebody debugging a claim looks for it.
 */

import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import * as styles from "../styles/styles.css";

/** The block shapes a tool row may be handed, narrowed to what it reads. */
export interface ToolRowBlock {
	readonly argsRaw?: unknown;
	readonly call?: { readonly argsRaw?: unknown } | null;
	readonly meta?: unknown;
	readonly isError?: boolean;
	readonly content?: readonly {
		readonly type?: string;
		readonly text?: string;
	}[];
}

/** What one integration says about its own calls. */
export interface ToolRowSpec {
	/**
	 * What the row leads with, in the reader's words rather than the wire's.
	 * @param toolName - the name the slot dispatched the call under, for a
	 *   provider that draws several tools with one row.
	 */
	displayName(toolName: string | undefined): string;
	/** What a preparing call asked for, from its arguments. */
	asked?(block: ToolRowBlock | undefined): string | undefined;
	/** One short phrase describing what a settled call found. */
	summarize(block: ToolRowBlock | undefined): string;
	/**
	 * What the settled dot says.
	 *
	 * A call that answered is usually done, but an integration whose answer
	 * reports a failure — a check that did not pass — says so here.
	 */
	state?(block: ToolRowBlock | undefined): "done" | "error";
}

/** What the tool-view seat hands the row. */
export interface ToolRowProps {
	readonly phase?: string;
	readonly block?: ToolRowBlock;
	readonly toolName?: string;
}

/** The server's own words, as a last resort for a failed call. */
const resultText = (block: ToolRowBlock | undefined): string =>
	(block?.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();

/**
 * The call exactly as the harness sees it, for the reader debugging a claim.
 *
 * The terse row is the right default — a card is not a transcript — but hiding
 * the arguments and the answer behind a tooltip makes a failed or surprising
 * call impossible to inspect. The details are escaped by React and scroll
 * inside the same code block the rest of the page uses.
 */
const rawCall = (block: ToolRowBlock | undefined): string => {
	const args = block?.argsRaw ?? block?.call?.argsRaw;
	const answer = resultText(block);
	const parts: string[] = [];

	if (typeof args === "string" && args.trim() !== "")
		parts.push(`args: ${args.trim()}`);
	if (answer !== "") parts.push(answer);

	return parts.join("\n\n") || "The call carried no arguments and no text.";
};

/**
 * The arguments of a call, when the row can still see them.
 *
 * A preparing call may hold half-written JSON, so a failed parse answers an empty
 * object rather than throwing: what a row says about a call in flight is a
 * courtesy, and every argument it reads is optional anyway.
 * @param block - the block the tool-view seat handed the row.
 * @returns the parsed arguments, or an empty object.
 */
export const blockArgs = (
	block: ToolRowBlock | undefined,
): Record<string, unknown> => {
	for (const raw of [block?.argsRaw, block?.call?.argsRaw]) {
		if (typeof raw !== "string" || raw === "") continue;

		try {
			const parsed: unknown = JSON.parse(raw);

			if (
				parsed !== null &&
				typeof parsed === "object" &&
				!Array.isArray(parsed)
			)
				return parsed as Record<string, unknown>;
		} catch {
			// A preparing call can hold half-written JSON; the arguments are optional.
		}
	}

	return {};
};

/**
 * Build the tool row for one integration.
 * @param spec - the integration's label for the tool and what it says about calls.
 * @returns the component the plugin registers under each tool name it draws.
 */
export const createToolRow = (
	spec: ToolRowSpec,
): ((props: ToolRowProps) => ReactNode) => {
	const Row = ({ phase, block, toolName }: ToolRowProps): ReactNode => {
		const name = spec.displayName(toolName);

		if (phase !== "result") {
			return (
				<div className={styles.toolRow} data-tool={toolName} title={toolName}>
					<StateDot state="ongoing" />
					<span className={styles.toolLabel}>{name}</span>
					{spec.asked === undefined ? null : (
						<span className={styles.caption}>{spec.asked(block) ?? "…"}</span>
					)}
				</div>
			);
		}

		if (block?.isError === true) {
			return (
				<div className={styles.toolRow} data-tool={toolName} title={toolName}>
					<StateDot state="error" />
					<span className={styles.toolLabel}>{name}</span>
					<span className={`${styles.caption} ${styles.error}`}>
						{resultText(block) || "failed"}
					</span>
				</div>
			);
		}

		return (
			<details className={styles.toolDetails}>
				<summary
					className={`${styles.toolRow} ${styles.toolSummary}`}
					data-tool={toolName}
					title={toolName}
				>
					<StateDot state={spec.state?.(block) ?? "done"} />
					<span className={styles.toolLabel}>{name}</span>
					<span className={styles.caption}>{spec.summarize(block)}</span>
				</summary>

				<pre className={styles.code}>{rawCall(block)}</pre>
			</details>
		);
	};

	return Row;
};

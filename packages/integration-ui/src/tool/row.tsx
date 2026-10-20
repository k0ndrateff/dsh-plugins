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
 * this row adds is the count and the query the call resolved.
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
	/** What the row calls the tool, given the name the slot dispatched it under. */
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
 * Build the tool row for one integration.
 * @param spec - the integration's name for the tool and what it says about calls.
 * @returns the component the plugin registers under each tool name it draws.
 */
export const createToolRow = (
	spec: ToolRowSpec,
): ((props: ToolRowProps) => ReactNode) => {
	const Row = ({ phase, block, toolName }: ToolRowProps): ReactNode => {
		const name = spec.displayName(toolName);

		if (phase !== "result") {
			return (
				<div className={styles.toolRow} data-tool={toolName}>
					<StateDot state="ongoing" />
					<span className={styles.toolName}>{name}</span>
					{spec.asked === undefined ? null : (
						<span className={styles.caption}>{spec.asked(block) ?? "…"}</span>
					)}
				</div>
			);
		}

		if (block?.isError === true) {
			return (
				<div className={styles.toolRow} data-tool={toolName}>
					<StateDot state="error" />
					<span className={styles.toolName}>{name}</span>
					<span className={`${styles.caption} ${styles.error}`}>
						{resultText(block) || "failed"}
					</span>
				</div>
			);
		}

		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state={spec.state?.(block) ?? "done"} />
				<span className={styles.toolName}>{name}</span>
				<span className={styles.caption}>{spec.summarize(block)}</span>
			</div>
		);
	};

	return Row;
};

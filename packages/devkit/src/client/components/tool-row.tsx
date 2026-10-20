/**
 * The checks tool row: what the call did, in one line.
 *
 * Claiming the name in `tool.call.toolview` replaces the generic row for **every**
 * shape of that call — preparing, running, failed, replayed — so this component
 * owns all of them. It stays terse on purpose: the failures belong to the card
 * under the answer, and a tool group that reproduces them buries the answer.
 */

import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { asChecksCard, type ChecksCard, checkLabel } from "../../shared/checks";
import * as styles from "../styles/styles.css";

/** The block shapes this row may be handed, narrowed to what it reads. */
interface ToolRowBlock {
	argsRaw?: unknown;
	call?: { argsRaw?: unknown } | null;
	meta?: unknown;
	isError?: boolean;
	content?: readonly { type?: string; text?: string }[];
}

/** How many checks the row names before it counts the rest. */
const NAMED_CHECKS = 3;

/** The result text, as a last resort for a failed call. */
const resultText = (block: ToolRowBlock | undefined): string =>
	(block?.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();

/** The recipe the call asked for, when the row can still see the arguments. */
const askedName = (block: ToolRowBlock | undefined): string | undefined => {
	for (const raw of [block?.argsRaw, block?.call?.argsRaw]) {
		if (typeof raw !== "string" || raw === "") continue;

		try {
			const parsed = JSON.parse(raw) as { name?: unknown };

			if (typeof parsed.name === "string" && parsed.name !== "")
				return parsed.name;
		} catch {
			// A preparing call can hold half-written JSON; the name is optional.
		}
	}

	return undefined;
};

/** One short phrase per check, in config order. */
const summarize = (card: ChecksCard): string => {
	const named = card.checks
		.slice(0, NAMED_CHECKS)
		.map(
			(check) =>
				`${check.name} ${check.status === "passed" ? "✓" : "✗"} ${checkLabel(check)}`,
		);
	const rest = card.checks.length - named.length;

	if (rest > 0) named.push(`… ${rest} more`);

	return named.join(" · ");
};

interface Props {
	phase?: string;
	block?: ToolRowBlock;
	toolName?: string;
}

/** One `checks` call, as a single line. */
export const ChecksToolRow = ({ phase, block, toolName }: Props) => {
	const card = asChecksCard(block?.meta);

	if (phase !== "result" || card === undefined) {
		const asked = askedName(block);

		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="ongoing" />
				<span className={styles.toolName}>checks</span>
				<span className={styles.caption}>{asked ?? "…"}</span>
			</div>
		);
	}

	if (block?.isError === true)
		return (
			<div className={styles.toolRow} data-tool={toolName}>
				<StateDot state="error" />
				<span className={styles.toolName}>checks</span>
				<span className={`${styles.caption} ${styles.error}`}>
					{resultText(block) || "failed"}
				</span>
			</div>
		);

	return (
		<div className={styles.toolRow} data-tool={toolName}>
			<StateDot state={card.ok ? "done" : "error"} />
			<span className={styles.toolName}>checks</span>
			<span className={styles.caption}>{summarize(card)}</span>
		</div>
	);
};

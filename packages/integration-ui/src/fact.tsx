/**
 * The named facts about one item, and the coloured value that is not a fact.
 *
 * A panel's metadata is mostly a list of fields the reader scans rather than
 * reads: who it is assigned to, when it was last seen, how many times it fired.
 * Stacked as chips that list becomes a wall of boxes, so a fact is a row —
 * a tertiary label and a primary value — and the same component serves a card in
 * Settings and an item in the Sidebar.
 *
 * A fact without a value renders nothing, so a caller lists every field it knows
 * about without branching on each one. What keeps a chip is the value whose
 * colour is the information: a state, a priority, a draft marker.
 *
 * `Facts` draws the grid; `Chip` is one coloured value, optionally named.
 */

import type { TagTone } from "@deepseek-ai/dsh-client-ui-primitives";
import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { Fragment, type ReactNode } from "react";
import * as styles from "./styles/styles.css";

/** One field: its name, and what the provider knows about it. */
export interface FactItem {
	/** The field's name, as the provider words it ("Assignee", "Last seen"). */
	readonly label: string;
	/** The value; a node when it is a link. Absence drops the row. */
	readonly value?: ReactNode;
}

/** Whether a fact has anything to show. */
const hasValue = (item: FactItem): boolean =>
	item.value !== undefined &&
	item.value !== null &&
	item.value !== "" &&
	// React collapses a fragment of nulls to nothing; an empty array is the same
	// answer from a provider that built its rows conditionally.
	!(Array.isArray(item.value) && item.value.length === 0);

/**
 * How a set of facts is laid out.
 *
 * `rows` is for one item read on its own — a panel, a settings card: the values
 * line up in a column. `inline` is for an item that is one entry of a list, where
 * the fields are a caption under the title and a column of two-cell rows would
 * push the next entry off the screen.
 */
export type FactsLayout = "rows" | "inline";

/**
 * Render one item's named fields as a label-and-value list.
 * @param props.items - the fields, in the order the reader should scan them.
 * @param props.layout - a column of rows, or one wrapping line.
 * @returns the list, or nothing when no field has a value.
 */
export const Facts = ({
	items,
	layout = "rows",
}: {
	readonly items: readonly FactItem[];
	readonly layout?: FactsLayout;
}) => {
	const shown = items.filter(hasValue);

	if (shown.length === 0) return null;

	if (layout === "inline") {
		return (
			<ul className={styles.factsInline}>
				{shown.map((item) => (
					<li className={styles.factInline} key={item.label}>
						<span className={styles.factInlineLabel}>{item.label}</span>
						<span className={styles.factValue}>{item.value}</span>
					</li>
				))}
			</ul>
		);
	}

	return (
		<dl className={styles.facts}>
			{shown.map((item) => (
				<Fragment key={item.label}>
					<dt className={styles.factLabel}>{item.label}</dt>
					<dd className={styles.factValue}>{item.value}</dd>
				</Fragment>
			))}
		</dl>
	);
};

interface ChipProps {
	/** The field's name, when the value needs one ("Priority: P2"). */
	readonly label?: string;
	readonly value?: string;
	/** Which palette the value earns. */
	readonly tone?: TagTone;
}

/**
 * One coloured value.
 *
 * With a `label` it reads as a named field; without one it is the value itself,
 * which is how a state becomes a coloured chip instead of another "State: …".
 */
export const Chip = ({ label, value, tone = "outline" }: ChipProps) => {
	if (value === undefined || value === "") return null;

	return (
		<Tag tone={tone}>{label === undefined ? value : `${label}: ${value}`}</Tag>
	);
};

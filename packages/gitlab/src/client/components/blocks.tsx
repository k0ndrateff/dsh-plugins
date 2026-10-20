/**
 * The pieces every tab of the merge request panel is built from.
 *
 * A titled block, rendered Markdown, and one date in the reader's own locale:
 * three things each tab would otherwise spell for itself.
 */

import type { MarkdownLabels } from "@deepseek-ai/dsh-client-ui-primitives";
import { MarkdownText } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import type { PanelPerson } from "../../shared/panel";
import * as styles from "../styles/styles.css";

/** Chrome for the Markdown renderer; one identity for the whole panel. */
const MARKDOWN_LABELS: MarkdownLabels = {
	code: { copyLabel: "Copy", copiedLabel: "Copied" },
	footnotes: "Footnotes",
};

/** One date as the reader's own locale writes it. */
export function whenText(value: string): string {
	const time = Date.parse(value);

	return Number.isNaN(time)
		? value
		: new Date(time).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			});
}

/** The usernames of a set of people, in the order GitLab listed them. */
export function peopleText(people: readonly PanelPerson[]): string | undefined {
	if (people.length === 0) return undefined;

	return people.map((person) => person.username).join(", ");
}

/** One titled block of the panel. */
export const Section = ({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): ReactNode => (
	<section className={styles.panelSection}>
		<span className={styles.panelSectionTitle}>{title}</span>
		{children}
	</section>
);

/** Rendered Markdown, with links leaving for the browser rather than the page. */
export const Prose = ({ text }: { text: string }): ReactNode => (
	<div className={styles.description}>
		<MarkdownText text={text} labels={MARKDOWN_LABELS} variant="compact" />
	</div>
);

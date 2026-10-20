/**
 * The card `atlassian_present` shows, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: the card is an answer-shaped artifact
 * rather than a step in the work, so it belongs beneath the prose, outside the
 * collapsible tool group — the same place `present` puts its file cards.
 *
 * The seat renders for every completed turn and narrows its own turn here, so
 * two cards shown in one turn both render, in call order.
 */

import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
	type PresentedCard,
	selectPresentations,
} from "../conversation/presentation-definition";
import * as styles from "../styles/styles.css";
import { IssueItem } from "./issue-item";
import { PageItem } from "./page-item";

/** Past this many rows a card scrolls instead of growing without limit. */
const SCROLL_AFTER = 4;

/**
 * What the card's heading says about its contents.
 * @param presentation - the card being drawn.
 * @returns "3 issues", "2 pages", or "5 of 42 issues" when more matched.
 */
const countLabel = (presentation: PresentedCard): string => {
	const issues = presentation.items.filter(
		(item) => item.kind === "issue",
	).length;
	const pages = presentation.items.length - issues;
	const total = presentation.total;

	// A single kind of item can say how many matched; a mixed card would have to
	// say "of" twice, so it keeps the plain counts.
	if (total !== undefined && (issues === 0 || pages === 0)) {
		const noun = issues === 0 ? "page" : "issue";

		return `${presentation.items.length} of ${total} ${noun}${total === 1 ? "" : "s"}`;
	}

	return [
		issues === 0 ? "" : `${issues} issue${issues === 1 ? "" : "s"}`,
		pages === 0 ? "" : `${pages} page${pages === 1 ? "" : "s"}`,
	]
		.filter(Boolean)
		.join(" · ");
};

/** One card: a heading over its items. */
const Card = ({ presentation }: { presentation: PresentedCard }) => (
	<section
		className={styles.presentation}
		data-atlassian-card={presentation.callId}
	>
		<div className={styles.presentationHead}>
			{presentation.title === undefined ? null : (
				<span className={styles.presentationTitle}>{presentation.title}</span>
			)}
			<span className={styles.presentationCount}>
				{countLabel(presentation)}
			</span>
		</div>

		<ul
			className={styles.list}
			data-layout={presentation.layout}
			data-scrollable={
				presentation.items.length > SCROLL_AFTER ? "true" : undefined
			}
		>
			{presentation.items.map((item, index) =>
				item.kind === "issue" ? (
					<IssueItem
						key={item.issue.key ?? `issue-${index}`}
						issue={item.issue}
					/>
				) : (
					<PageItem key={item.page.id ?? `page-${index}`} page={item.page} />
				),
			)}
		</ul>
	</section>
);

/**
 * Render every card one completed turn asked to show.
 * @param props - the closing turn and its sequence.
 * @returns the cards, or null for a turn that showed none.
 */
export const PresentationTail = (
	props: PropsRuntime<"conversation.chat.turnTail">,
) => {
	const matched = selectPresentations(props);

	if (matched === null) return null;

	return (
		<div className={styles.presentations}>
			{matched.presentations.map((presentation) => (
				<Card key={presentation.callId} presentation={presentation} />
			))}
		</div>
	);
};

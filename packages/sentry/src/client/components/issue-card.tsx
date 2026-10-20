/**
 * The card `sentry_present` shows, under the closing text of its turn.
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
} from "../conversation/card-definition";
import * as styles from "../styles/styles.css";
import { IssueItem } from "./issue-item";
import { SuspectRow } from "./suspect-row";

/** Past this many rows a card scrolls instead of growing without limit. */
const SCROLL_AFTER = 4;

/**
 * What the card's heading says about its contents.
 * @param presentation - the card being drawn.
 * @returns "3 issues", or "3 of 42 issues" when more matched than are shown.
 */
const countLabel = (presentation: PresentedCard): string => {
	const count = presentation.issues.length;
	const total = presentation.total;

	return total === undefined || total <= count
		? `${count} issue${count === 1 ? "" : "s"}`
		: `${count} of ${total} issues`;
};

/** One card: a heading, the query it ran, then its items. */
const Card = ({ presentation }: { presentation: PresentedCard }) => {
	const hasMeta =
		presentation.query !== undefined || presentation.dashboardUrl !== undefined;

	return (
		<section
			className={styles.presentation}
			data-sentry-card={presentation.callId}
		>
			<div className={styles.presentationHead}>
				{presentation.title === undefined ? null : (
					<span className={styles.presentationTitle}>{presentation.title}</span>
				)}
				<span className={styles.presentationCount}>
					{countLabel(presentation)}
				</span>
			</div>

			{hasMeta ? (
				<div className={styles.cardMeta}>
					{presentation.query === undefined ? null : (
						<code className={styles.query}>{presentation.query}</code>
					)}

					{presentation.dashboardUrl === undefined ? null : (
						<a
							className={styles.link}
							href={presentation.dashboardUrl}
							target="_blank"
							rel="noreferrer"
						>
							All results in Sentry
						</a>
					)}
				</div>
			) : null}

			<ul
				className={styles.list}
				data-layout={presentation.layout}
				data-scrollable={
					presentation.issues.length > SCROLL_AFTER ? "true" : undefined
				}
			>
				{presentation.issues.map((issue) => (
					<IssueItem key={issue.id} issue={issue} />
				))}
			</ul>

			{presentation.suspect === undefined ? null : (
				<SuspectRow suspect={presentation.suspect} label="Suspect commit" />
			)}
		</section>
	);
};

/**
 * Render every card one completed turn asked to show.
 * @param props - the closing turn and its sequence.
 * @returns the cards, or null for a turn that showed none.
 */
export const SentryTail = (
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

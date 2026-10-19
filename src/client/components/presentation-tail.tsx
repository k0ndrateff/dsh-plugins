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

/** One card: an optional heading over its items. */
const Card = ({ presentation }: { presentation: PresentedCard }) => (
	<section
		className={styles.presentation}
		data-atlassian-card={presentation.callId}
	>
		{presentation.title === undefined ? null : (
			<div className={styles.presentationHead}>
				<span className={styles.presentationTitle}>{presentation.title}</span>
			</div>
		)}

		<ul className={styles.list} data-layout={presentation.layout}>
			{presentation.items.map((item, index) =>
				item.kind === "issue" ? (
					<IssueItem
						key={item.issue.key ?? `issue-${index}`}
						issue={item.issue}
						dense={presentation.layout === "list"}
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

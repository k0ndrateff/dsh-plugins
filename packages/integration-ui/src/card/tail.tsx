/**
 * The cards one turn contributes, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: a card is an answer-shaped artifact
 * rather than a step in the work, so it belongs beneath the prose, outside the
 * collapsible tool group — the same place `present` puts its file cards.
 *
 * The seat renders for every completed turn and narrows its own turn here, so
 * two cards shown in one turn both render, in call order.
 */

import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { type ReactNode, useState } from "react";
import * as styles from "../styles/styles.css";
import type { PresentationType } from "./definition";

/** Past this many rows a card scrolls instead of growing without limit. */
const SCROLL_AFTER = 4;

/**
 * Build the turn-tail seat for one integration.
 * @param type - the card definition, its turn reader, and its drawing rules.
 * @returns the component the plugin registers in `conversation.chat.turnTail`.
 */
export const createPresentationTail = <TCard, TOwner = unknown>(
	type: PresentationType<TCard, TOwner>,
): ((props: PropsRuntime<"conversation.chat.turnTail">) => ReactNode) => {
	const Tail = (
		props: PropsRuntime<"conversation.chat.turnTail">,
	): ReactNode => {
		const matched = type.select(props);
		const [expanded, setExpanded] = useState<ReadonlySet<string>>(
			() => new Set(),
		);

		if (matched === null) return null;

		return (
			<div className={styles.presentations}>
				{matched.presentations.map((presentation) => {
					const card = presentation.card;
					const callId = type.card.callId(card);
					const title = type.card.title(card);
					const count = type.card.length(card);
					const open = expanded.has(callId);
					const meta = type.card.meta?.(card, props as TOwner);
					const footer = type.card.footer?.(card, props as TOwner);

					return (
						<section
							key={callId}
							className={styles.presentation}
							data-integration-card={callId}
							aria-labelledby={
								title === undefined ? undefined : `${callId}-title`
							}
						>
							<div className={styles.presentationHead}>
								{title === undefined ? null : (
									<h3
										className={styles.presentationTitle}
										id={`${callId}-title`}
									>
										{title}
									</h3>
								)}
								<span className={styles.presentationCount}>
									{type.card.count(card)}
								</span>
							</div>

							{meta}

							<ul
								className={styles.list}
								data-layout={type.card.layout(card)}
								data-scrollable={
									!open && count > SCROLL_AFTER ? "true" : undefined
								}
							>
								{type.card.items(card, props as TOwner)}
							</ul>

							{count <= SCROLL_AFTER ? null : (
								<button
									type="button"
									className={styles.showAll}
									aria-expanded={open}
									onClick={() => {
										setExpanded((current) => {
											const next = new Set(current);

											if (next.has(callId)) next.delete(callId);
											else next.add(callId);

											return next;
										});
									}}
								>
									{open
										? "Show less"
										: `Show all ${count} ${count === 1 ? "row" : "rows"}`}
								</button>
							)}

							{footer}
						</section>
					);
				})}
			</div>
		);
	};

	return Tail;
};

/**
 * One Confluence page on a card.
 *
 * Like an issue row, the whole card is the link and the body is compressed to
 * the one sentence the card can afford.
 */

import { Facts } from "dsh-integration-ui";
import type { PageCard } from "../../shared/meta";
import { openPanel, wantsBrowser } from "../sidebar/open";
import * as styles from "../styles/styles.css";

interface Props {
	page: PageCard;
}

export const PageItem = ({ page }: Props) => {
	return (
		<li className={styles.item}>
			<div className={styles.itemHead}>
				{page.url === undefined ? (
					<span>{page.title}</span>
				) : (
					<a
						className={`${styles.link} ${styles.itemLink}`}
						href={page.url}
						target="_blank"
						rel="noreferrer"
						onClick={(event) => {
							// A page id is what the panel needs; a card that only knows a
							// URL leaves the click to the browser.
							if (wantsBrowser(event) || page.id === undefined) return;
							if (
								openPanel({
									kind: "page",
									id: page.id,
									title: page.title,
								})
							)
								event.preventDefault();
						}}
					>
						{page.title}
					</a>
				)}
			</div>

			{page.excerpt === undefined ? null : (
				<p className={styles.itemText}>{page.excerpt}</p>
			)}

			<Facts layout="inline" items={[{ label: "Space", value: page.space }]} />
		</li>
	);
};

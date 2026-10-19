/**
 * One Confluence page on a card.
 *
 * Like an issue row, the whole card is the link and the body is compressed to
 * the one sentence the card can afford.
 */

import type { PageCard } from "../../shared/meta";
import * as styles from "../styles/styles.css";
import { Badge } from "./badge";

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
					>
						{page.title}
					</a>
				)}
			</div>

			{page.excerpt === undefined ? null : (
				<p className={styles.itemText}>{page.excerpt}</p>
			)}

			<div className={styles.badges}>
				<Badge label="Space" value={page.space} />
			</div>
		</li>
	);
};

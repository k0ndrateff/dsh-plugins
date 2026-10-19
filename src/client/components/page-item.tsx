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
						className={styles.link}
						href={page.url}
						target="_blank"
						rel="noreferrer"
					>
						{page.title}
					</a>
				)}
			</div>

			<div className={styles.badges}>
				<Badge label="Space" value={page.space} />
			</div>
		</li>
	);
};

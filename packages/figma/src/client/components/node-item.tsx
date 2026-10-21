/**
 * One node on a card.
 *
 * The row is the link to the picture: its identity is a button, because a node
 * id is not a URL — the file it belongs to is not part of what the server
 * answered — and a click opens the harness's own panel on that node.
 */

import { Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { Facts } from "dsh-integration-ui";
import type { FigmaNodeCard } from "../../shared/meta";
import { openPanel } from "../sidebar/open";
import * as styles from "../styles/styles.css";

interface Props {
	node: FigmaNodeCard;
}

/** One node, as a card row shows it. */
export const FigmaNodeItem = ({ node }: Props) => (
	<li className={styles.item}>
		<div className={styles.itemHead}>
			<button
				type="button"
				className={`${styles.link} ${styles.itemLink} ${styles.rowButton}`}
				onClick={() => {
					openPanel({ node: node.id });
				}}
			>
				{node.id}
			</button>

			<span className={styles.itemTitle}>{node.name}</span>

			<Tag tone="neutral">{node.type}</Tag>
		</div>

		<Facts
			layout="inline"
			items={[
				{ label: "Size", value: `${node.width}×${node.height}` },
				{ label: "Variables", value: node.tokenCount },
				{ label: "Children", value: node.childCount },
				{ label: "Component", value: node.component },
			]}
		/>
	</li>
);

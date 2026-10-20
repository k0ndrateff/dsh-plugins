/**
 * The click target a card row is built around.
 *
 * The row's identity anchors a stretched overlay, so a click anywhere on the row
 * opens the item: the harness's own panel when it is there, and the provider's
 * page for a modified click or a build without that panel. A row whose item has
 * no URL is still clickable — a button carries the same overlay — which matters
 * because GitLab does not name a page for every finding.
 */

import type { MouseEvent } from "react";
import type { PanelTarget } from "../../shared/panel";
import { openPanel, wantsBrowser } from "../sidebar/open";
import * as styles from "../styles/styles.css";

/**
 * Show one item in the harness's panel, unless the user asked for the browser.
 * @param event - the click on the row.
 * @param target - what to open.
 */
export function openTarget(
	event: MouseEvent<HTMLElement>,
	target: PanelTarget,
): void {
	if (wantsBrowser(event)) return;
	if (openPanel(target)) event.preventDefault();
}

interface Props {
	/** The provider's own page, when it named one. */
	readonly url?: string;
	readonly label: string;
	onOpen(event: MouseEvent<HTMLElement>): void;
}

/** One row's identity, linked out and opening the panel. */
export const RowLink = ({ url, label, onOpen }: Props) =>
	url === undefined ? (
		<button
			type="button"
			className={`${styles.link} ${styles.itemLink} ${styles.rowButton}`}
			onClick={onOpen}
		>
			{label}
		</button>
	) : (
		<a
			className={`${styles.link} ${styles.itemLink}`}
			href={url}
			target="_blank"
			rel="noreferrer"
			onClick={onOpen}
		>
			{label}
		</a>
	);

/**
 * The frame's picture in the panel.
 *
 * The document the host serves carries a URL rather than bytes, so the page
 * fetches the picture itself — and a node the server has no image for is an
 * ordinary answer rather than a broken panel, so a failed load says so in place
 * instead of leaving the browser's own broken-image mark.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import * as styles from "../styles/styles.css";

interface Props {
	/** The route the picture is fetched from, or null when there is none. */
	readonly src: string | null;
	/** What the picture shows, for a reader who cannot see it. */
	readonly alt: string;
}

/** One node's picture, with its own failure state. */
export const FrameImage = ({ src, alt }: Props): ReactNode => {
	const [failed, setFailed] = useState(false);

	if (src === null || failed)
		return (
			<div className={styles.frameMissing}>
				The Figma server sent no picture for this node.
			</div>
		);

	return (
		<img
			className={styles.frameImage}
			src={src}
			alt={alt}
			onError={() => setFailed(true)}
		/>
	);
};

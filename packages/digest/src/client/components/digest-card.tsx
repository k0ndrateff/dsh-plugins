/**
 * How one digest draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; what is
 * the digest's is that the list holds *blocks* rather than rows: each block is
 * one integration's answer, with its own heading, its own reason for being
 * empty, and its own rows. That is the shape the roadmap asked for — one card,
 * sections inside it — and it keeps a provider's silence legible: "nothing is
 * waiting for your review" and "GitLab is not connected" are different lines.
 *
 * A digest with no blocks at all says why in its footer: no integration
 * connected, or every block switched off. Both are one line, and both have a
 * next step, which "0 blocks" does not.
 */

import type { CardProvider } from "dsh-integration-ui";
import {
	type DigestReport,
	type DigestSection,
	digestStamp,
	emptyDigestNote,
} from "../../shared/digest";
import * as styles from "../styles/styles.css";

/** One block of the card: its heading, its reason or its rows. */
const Block = ({ section }: { section: DigestSection }) => (
	<li className={styles.digestBlock}>
		<div className={styles.blockHead}>
			<span className={styles.blockTitle}>{section.title}</span>
			<span className={styles.blockProvider}>{section.provider}</span>
		</div>

		{section.unavailable === undefined ? null : (
			<p className={styles.blockNote}>{section.unavailable}</p>
		)}

		{section.unavailable !== undefined || section.items.length > 0 ? null : (
			<p className={styles.blockNote}>Nothing to report.</p>
		)}

		<ul className={styles.blockList}>
			{section.items.map((item) => (
				<li className={styles.digestRow} key={item.id}>
					<div className={styles.rowHead}>
						{item.url === undefined ? (
							<span className={styles.rowTitle}>{item.title}</span>
						) : (
							<a
								className={`${styles.link} ${styles.itemLink}`}
								href={item.url}
								target="_blank"
								rel="noreferrer"
							>
								{item.title}
							</a>
						)}
					</div>

					{item.meta === undefined ? null : (
						<span className={styles.rowMeta}>{item.meta}</span>
					)}
				</li>
			))}
		</ul>

		{section.truncated === true && section.total !== undefined ? (
			<p className={styles.blockNote}>
				{`Showing ${section.items.length} of at least ${section.total} rows — raise Rows per block in Settings → Digest to see more.`}
			</p>
		) : null}
	</li>
);

/** The digest card, as the shared tail draws it. */
export const digestCard: CardProvider<DigestReport> = {
	callId: (report) => report.callId,
	title: (report) => report.title,
	count: (report) => {
		const rows = report.sections.reduce(
			(total, section) => total + section.items.length,
			0,
		);

		return `${rows} row${rows === 1 ? "" : "s"} · ${report.sections.length} block${report.sections.length === 1 ? "" : "s"}`;
	},
	length: (report) => report.sections.length,
	// A digest is a set of sections, so it always reads as a list however short
	// it is: one block drawn as a single full-width card would look like an
	// answer rather than a summary.
	layout: () => "list",
	items: (report) =>
		report.sections.map((section) => (
			<Block key={section.block} section={section} />
		)),
	// The zone is named, and the same words are in the model's text: one instant
	// read by two parties should not depend on which locale each runs under.
	meta: (report) => (
		<span className={styles.caption}>
			{`Assembled ${digestStamp(report.generatedAt, report.timeZone)}`}
		</span>
	),
	footer: (report) =>
		report.sections.length === 0 && report.offered !== undefined ? (
			<p className={styles.blockNote}>{emptyDigestNote(report.offered)}</p>
		) : null,
};

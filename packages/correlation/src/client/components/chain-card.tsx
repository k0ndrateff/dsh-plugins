/**
 * How one walked chain draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; what is
 * the chain's is that the list reads *in order and downward* — an error, the
 * commit behind it, the merge request that commit belongs to, the ticket that
 * names — so each hop is numbered and names the provider that answered it. A hop
 * nobody could follow is drawn the same way but says why, because where a chain
 * stops is part of the answer.
 */

import type { CardProvider } from "dsh-integration-ui";
import type { ChainBreak, ChainHop, ChainReport } from "../../shared/meta";
import * as styles from "../styles/styles.css";

/** One hop: what it is, who answered, and what it says. */
const Hop = ({
	hop,
	step,
}: {
	readonly hop: ChainHop;
	readonly step: number;
}) => (
	<li className={styles.hop}>
		<span className={styles.step}>{step}</span>

		<div className={styles.hopBody}>
			<div className={styles.hopHead}>
				<span className={styles.hopKind}>{hop.label}</span>
				<span className={styles.hopProvider}>{hop.provider}</span>
			</div>

			{hop.url === undefined ? (
				<span className={styles.hopTitle}>{hop.title}</span>
			) : (
				<a
					className={styles.link}
					href={hop.url}
					target="_blank"
					rel="noreferrer"
				>
					{hop.title}
				</a>
			)}

			{hop.meta === undefined ? null : (
				<span className={styles.hopMeta}>{hop.meta}</span>
			)}
		</div>
	</li>
);

/** A hop that was not followed, and the reason. */
const Break = ({ item }: { readonly item: ChainBreak }) => (
	<li className={styles.hop}>
		<span className={styles.step}>—</span>

		<div className={styles.hopBody}>
			<div className={styles.hopHead}>
				<span className={styles.hopKind}>{item.label}</span>
			</div>

			<span className={styles.hopMeta}>{item.reason}</span>
		</div>
	</li>
);

/** The chain card, as the shared tail draws it. */
export const chainCard: CardProvider<ChainReport> = {
	callId: (report) => report.callId,
	title: (report) => report.title,
	count: (report) => {
		const hops = `${report.hops.length} hop${report.hops.length === 1 ? "" : "s"}`;

		return report.breaks.length === 0
			? hops
			: `${hops} · ${report.breaks.length} not followed`;
	},
	length: (report) => report.hops.length + report.breaks.length,
	// A chain is a list of steps however short it is: one hop drawn as a single
	// full-width card would read as an answer rather than a link in one.
	layout: () => "list",
	items: (report) => [
		...report.hops.map((hop, index) => (
			<Hop hop={hop} key={hop.id} step={index + 1} />
		)),
		...report.breaks.map((item, index) => (
			<Break item={item} key={`${item.kind}-${item.label}-${String(index)}`} />
		)),
	],
	meta: (report) => (
		<span className={styles.caption}>From {report.provider}</span>
	),
};

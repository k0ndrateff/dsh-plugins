/**
 * How one walked chain draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; what is
 * the chain's is that the list reads *in order and downward* — an error, the
 * commit behind it, the merge request that commit belongs to, the ticket that
 * names — so each hop is numbered, indented by its distance from the anchor, and
 * names the provider that answered it.
 *
 * A hop nobody could follow is not a hop: it is drawn apart from them, in the
 * warning tint, with the words "Not followed", the class of the failure, and the
 * provider's own reason. It sits under the hop that pointed at it, because that
 * is where the chain broke. The footer says what to do about it.
 */

import type { CardProvider } from "dsh-integration-ui";
import {
	BREAK_CAUSE_LABELS,
	type ChainBreak,
	type ChainCoverage,
	type ChainHop,
	type ChainReport,
} from "../../shared/meta";
import * as styles from "../styles/styles.css";

/** One indent class per depth the walk may reach; deeper levels clamp. */
const DEPTHS = [
	styles.depth0,
	styles.depth1,
	styles.depth2,
	styles.depth3,
	styles.depth4,
] as const;

/** The indent class for one level of the chain. */
const atDepth = (depth: number): string =>
	DEPTHS[Math.min(Math.max(depth, 0), DEPTHS.length - 1)] ?? styles.depth0;

/** One hop: what it is, who answered, and what it says. */
const Hop = ({
	hop,
	step,
}: {
	readonly hop: ChainHop;
	readonly step: number;
}) => (
	<li className={`${styles.hop} ${atDepth(hop.depth)}`}>
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
	<li className={`${styles.breakRow} ${atDepth(item.depth)}`}>
		<span className={styles.breakMark} aria-hidden="true">
			×
		</span>

		<div className={styles.hopBody}>
			<div className={styles.hopHead}>
				<span className={styles.breakKind}>Not followed</span>
				<span className={styles.hopProvider}>{item.label}</span>

				{item.cause === undefined ? null : (
					<span className={styles.breakCause}>
						{BREAK_CAUSE_LABELS[item.cause]}
					</span>
				)}
			</div>

			<span className={styles.breakReason}>{item.reason}</span>
		</div>
	</li>
);

/** One shared kind, as the footer explains it. */
const coverageText = (item: ChainCoverage): string => {
	const other = item.providers.filter(
		(provider) => provider !== item.answeredBy,
	);

	return item.answeredBy === undefined
		? `${item.kind} references can be resolved by ${item.providers.join(", ")}.`
		: `${item.kind} references can be resolved by ${item.providers.join(", ")}; ${item.answeredBy} answered, ${other.join(", ")} was not asked.`;
};

/**
 * What the footer adds after the list: why a hop stopped and what to do next.
 *
 * Static advice rather than a per-break link, because the card has no action the
 * page can run: the fix is signing in or installing an integration, and the next
 * step is running the chain again once that is done.
 */
const footerText = (report: ChainReport): string | undefined => {
	const parts: string[] = [];

	if (report.breaks.length > 0)
		parts.push(
			"A hop is not followed when no installed integration resolves it, when the account has no access, or when nothing links it. Check the Integrations page, then run the chain again.",
		);

	if (report.breaks.some((item) => item.cause === "limit") && report.limits)
		parts.push(
			`The chain is capped at ${report.limits.depth} levels and ${report.limits.facts} hops.`,
		);

	for (const item of report.coverage ?? []) parts.push(coverageText(item));

	return parts.length === 0 ? undefined : parts.join(" ");
};

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
	items: (report) => {
		const used = new Set<number>();
		/** A break hangs under the hop that named it; the anchor's come first. */
		const take = (parent: string | undefined): readonly ChainBreak[] =>
			report.breaks.filter((item, index) => {
				if (used.has(index) || item.parent !== parent) return false;

				used.add(index);

				return true;
			});
		const rows = take(undefined).map((item, index) => (
			<Break item={item} key={`anchor-${item.kind}-${String(index)}`} />
		));

		for (const [index, hop] of report.hops.entries()) {
			rows.push(<Hop hop={hop} key={hop.id} step={index + 1} />);

			for (const [at, item] of take(hop.id).entries())
				rows.push(
					<Break item={item} key={`${hop.id}-${String(at)}-${item.kind}`} />,
				);
		}

		// A break whose parent hop is not in the chain still belongs on the card.
		for (const [index, item] of report.breaks.entries())
			if (!used.has(index))
				rows.push(<Break item={item} key={`orphan-${String(index)}`} />);

		return rows;
	},
	meta: (report) => (
		<span className={styles.caption}>From {report.provider}</span>
	),
	footer: (report) => {
		const text = footerText(report);

		return text === undefined ? null : (
			<span className={styles.caption}>{text}</span>
		);
	},
};

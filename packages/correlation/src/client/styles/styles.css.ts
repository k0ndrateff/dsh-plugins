/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the list, the terse tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what the chain's
 * own card adds: one numbered hop.
 *
 * vanilla-extract in this build accepts `&` with modifiers and a parent
 * selector, and nothing else, so every element a hop draws has a class of its
 * own rather than being reached through a descendant.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** One hop: its number, and everything the provider said about it. */
export const hop = style({
	display: "flex",
	alignItems: "flex-start",
	gap: "10px",
	padding: "6px 0",
});

/**
 * One level of the walk, per depth a chain may reach.
 *
 * A hop two references from the anchor is drawn under the one that pointed at
 * it, so a branch reads as a branch rather than as one long list. Indentation
 * is a class per level because vanilla-extract cannot take a computed style.
 */
export const depth0 = style({ paddingLeft: "0" });
export const depth1 = style({ paddingLeft: "16px" });
export const depth2 = style({ paddingLeft: "32px" });
export const depth3 = style({ paddingLeft: "48px" });
export const depth4 = style({ paddingLeft: "64px" });

/** A hop the chain could not follow: set apart from the hops it sits among. */
export const breakRow = style({
	display: "flex",
	alignItems: "flex-start",
	gap: "10px",
	marginLeft: "4px",
	padding: "4px 0 4px 8px",
	borderLeft: `2px solid ${theme.color.warn}`,
});

/** The mark in the step column of a break, in the warning tint. */
export const breakMark = style({
	flex: "0 0 auto",
	minWidth: "16px",
	fontSize: "12px",
	lineHeight: "20px",
	color: theme.color.warn,
});

/** The words "Not followed", which is what the mark means. */
export const breakKind = style({
	fontSize: "12px",
	fontWeight: 600,
	color: theme.color.warn,
});

/** The class of the failure, such as "access denied". */
export const breakCause = style({
	fontSize: "11px",
	lineHeight: "18px",
	color: theme.color.warn,
});

/** The provider's own words about why it stopped there. */
export const breakReason = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelSecondary,
});

/** The hop's place in the chain, in the reader's order. */
export const step = style({
	flex: "0 0 auto",
	minWidth: "16px",
	fontSize: "12px",
	lineHeight: "20px",
	fontVariantNumeric: "tabular-nums",
	color: theme.color.labelTertiary,
});

export const hopBody = style({
	flex: "1 1 auto",
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
	gap: "2px",
});

export const hopHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	flexWrap: "wrap",
});

/** What the hop is, and who answered it. */
export const hopKind = style({
	fontSize: "13px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
});

export const hopProvider = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

export const hopTitle = style({
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

export const hopMeta = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

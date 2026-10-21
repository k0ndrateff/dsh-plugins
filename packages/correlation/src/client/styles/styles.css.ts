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

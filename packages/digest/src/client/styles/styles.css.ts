/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the settings rows, the panel, the
 * terse tool row — is re-exported from `dsh-integration-ui`, so this file holds
 * only what the digest's own card adds: a block inside a list, and a row inside
 * a block.
 *
 * vanilla-extract in this build accepts `&` with modifiers and a parent
 * selector, and nothing else, so every element a block draws has a class of its
 * own rather than being reached through a descendant.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** One integration's answer, inside the card's list. */
export const digestBlock = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	padding: "10px 12px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
});

/** A block's own heading, and the provider that owns it. */
export const blockHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	flexWrap: "wrap",
});

export const blockTitle = style({
	fontSize: "13px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
});

export const blockProvider = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

/** What a block says when it has no rows, and why. */
export const blockNote = style({
	margin: 0,
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

/** The rows of one block. */
export const blockList = style({
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "grid",
	gap: "4px",
});

/** One row: its line, and one supporting detail beside it. */
export const digestRow = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	gap: "12px",
	padding: "3px 0",
});

export const rowHead = style({
	flex: "1 1 auto",
	minWidth: 0,
});

export const rowTitle = style({
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

export const rowMeta = style({
	flex: "0 0 auto",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	whiteSpace: "nowrap",
});

/** The settings card's day switches, laid out as one row of seven. */
export const days = style({
	display: "flex",
	alignItems: "center",
	gap: "12px",
	flexWrap: "wrap",
	margin: 0,
	padding: 0,
	border: "none",
	minWidth: 0,
});

/** One block of the settings card, with its own heading. */
export const block = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	paddingTop: "8px",
});

/** One staged field: its name, its control, and what the control means. */
export const field = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	paddingTop: "10px",
});

export const fieldHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const fieldLabel = style({
	fontSize: "13px",
	fontWeight: 500,
	color: theme.color.labelPrimary,
});

/** The mark on a field the draft moved away from what the host holds. */
export const fieldChanged = style({
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.labelTertiary,
});

/** The row that writes the staged settings, set off from what it writes. */
export const footer = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
	marginTop: "12px",
	paddingTop: "12px",
	borderTop: `0.5px solid ${theme.color.borderSubtle}`,
});

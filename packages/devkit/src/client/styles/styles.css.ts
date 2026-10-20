/**
 * The checks card and its tool row.
 *
 * Flat classes only: vanilla-extract in this build accepts `&` with modifiers
 * and nothing else, so every element the card draws has a name here rather than
 * being reached through a parent selector.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "./theme.css";

export const card = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	marginTop: "12px",
	padding: "12px",
	border: `1px solid ${theme.color.cardStroke}`,
	borderRadius: theme.radius.lg,
	background: theme.color.cardFill,
});

export const head = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const title = style({
	fontSize: "13px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
});

export const count = style({
	fontSize: "12px",
	color: theme.color.labelTertiary,
});

export const runs = style({
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	margin: 0,
	padding: 0,
	listStyle: "none",
});

export const run = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
});

export const runHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const markOk = style({
	color: theme.color.success,
	fontSize: "13px",
});

export const markBad = style({
	color: theme.color.danger,
	fontSize: "13px",
});

export const runName = style({
	fontSize: "13px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
	fontFamily: theme.font.code,
});

export const runLabel = style({
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

export const duration = style({
	marginLeft: "auto",
	fontSize: "11px",
	color: theme.color.labelTertiary,
	fontVariantNumeric: "tabular-nums",
});

export const failures = style({
	display: "flex",
	flexDirection: "column",
	gap: "2px",
	margin: 0,
	padding: "0 0 0 20px",
	listStyle: "none",
});

export const failure = style({
	display: "flex",
	alignItems: "baseline",
	gap: "6px",
	width: "100%",
	padding: "2px 4px",
	border: "none",
	borderRadius: theme.radius.sm,
	background: "transparent",
	textAlign: "left",
	cursor: "pointer",
	selectors: {
		"&:hover": { background: theme.color.hoverFill },
	},
});

export const failureStatic = style({
	display: "flex",
	padding: "2px 4px",
});

export const where = style({
	flexShrink: 0,
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.link,
});

export const message = style({
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

export const more = style({
	padding: "2px 4px",
	fontSize: "11px",
	color: theme.color.labelTertiary,
});

export const output = style({
	maxHeight: "220px",
	margin: 0,
	padding: "8px",
	overflow: "auto",
	borderRadius: theme.radius.sm,
	background: theme.color.codeFill,
	fontFamily: theme.font.code,
	fontSize: "11px",
	lineHeight: 1.45,
	color: theme.color.labelSecondary,
	whiteSpace: "pre-wrap",
});

export const toolRow = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const toolName = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

export const caption = style({
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

export const error = style({
	color: theme.color.danger,
});

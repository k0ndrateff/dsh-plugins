/**
 * The checks card and its tool row.
 *
 * What every integration draws — the card material, the tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what is
 * devkit's: one check's line, its failures, and the output nothing parsed.
 *
 * Flat classes only: vanilla-extract in this build accepts `&` with modifiers
 * and nothing else, so every element the card draws has a name here rather than
 * being reached through a parent selector.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

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

/** A cancelled run was neither a pass nor a failure of the check itself. */
export const markCancelled = style({
	color: theme.color.labelTertiary,
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

/** A warning even the linter does not consider a failure of the check. */
export const severityWarning = style({
	flexShrink: 0,
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.warn,
});

export const severityError = style({
	flexShrink: 0,
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.danger,
});

/** The rule or error code a failure came from, such as TS2322. */
export const rule = style({
	flexShrink: 0,
	fontFamily: theme.font.code,
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.labelTertiary,
});

/** The action that copies a failure's `path:line` for another tool. */
export const copy = style({
	flexShrink: 0,
	marginLeft: "auto",
	padding: "0 4px",
	border: "none",
	borderRadius: theme.radius.sm,
	background: "transparent",
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.labelTertiary,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: theme.color.hoverFill },
	},
});

/** The row that reveals the failures a card kept back. */
export const showAll = style({
	alignSelf: "flex-start",
	padding: "2px 4px",
	border: "none",
	borderRadius: theme.radius.sm,
	background: "transparent",
	fontSize: "11px",
	lineHeight: "16px",
	color: theme.color.link,
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

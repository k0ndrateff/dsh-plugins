/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the panel, the terse tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what is
 * Sentry's: the exception, its trace, its tags, and the suspect commit.
 */

import { style } from "@vanilla-extract/css";
import { list, theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** The exception's own words; the row's longest text, so it takes the slack. */
export const itemTitle = style({
	flex: "1 1 auto",
	minWidth: 0,
	selectors: {
		[`${list}[data-layout="list"] &`]: {
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
		},
	},
});

/** The assignee field: it takes the row, the button beside it does not. */
export const assignField = style({
	flex: "1 1 auto",
	minWidth: 0,
});

/** The exception line, above the trace it came from. */
export const message = style({
	margin: 0,
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

/** The full stack trace: a code block that keeps Sentry's own line breaks. */
export const stack = style({
	margin: 0,
	padding: "10px",
	maxHeight: "320px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	fontFamily: theme.font.code,
	fontSize: "12px",
	lineHeight: 1.5,
	borderRadius: theme.radius.lg,
	background: theme.color.codeFill,
});

export const tags = style({
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "flex",
	flexDirection: "column",
	gap: "4px",
});

export const tag = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const tagName = style({
	flex: "0 0 auto",
	minWidth: "120px",
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelTertiary,
});

export const tagValue = style({
	// A tag value can hold a URL or a long payload; without this it would push
	// the key out of the row it belongs to.
	minWidth: 0,
	fontSize: "12px",
	color: theme.color.labelPrimary,
	wordBreak: "break-word",
});

/** The commit Sentry suspects, as one row of its own. */
export const suspect = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	flexWrap: "wrap",
	padding: "8px 12px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
});

export const suspectLabel = style({
	fontSize: "11px",
	fontWeight: 600,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: theme.color.labelTertiary,
});

export const suspectText = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelSecondary,
});

/** A section title is a heading; the shared style is for its type, not its margins. */
export const sectionHeading = style({
	margin: 0,
	fontSize: "inherit",
	fontWeight: "inherit",
	lineHeight: "inherit",
});

/** What the panel says a just-confirmed write changed. */
export const changed = style({
	margin: 0,
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelPrimary,
});

/** The organization picker: one native select and its inline status, on one line. */
export const orgChoice = style({
	display: "inline-flex",
	alignItems: "baseline",
	gap: "6px",
	flexWrap: "wrap",
});

export const orgSelect = style({
	font: "inherit",
	color: "inherit",
	background: "transparent",
	border: `1px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.sm,
	padding: "2px 4px",
	maxWidth: "100%",
});

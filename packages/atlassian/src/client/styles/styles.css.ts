/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the panel, the terse tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what is
 * Atlassian's: rendered prose, the comment thread, and the people lookup.
 */

import { globalStyle, style } from "@vanilla-extract/css";
import { list, theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** The one sentence the card shows about an item, clamped to its layout. */
export const itemText = style({
	margin: 0,
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	display: "-webkit-box",
	WebkitBoxOrient: "vertical",
	WebkitLineClamp: 2,
	overflow: "hidden",
	selectors: {
		[`${list}[data-layout="list"] &`]: { WebkitLineClamp: 1 },
	},
});

/** Rendered Markdown, with its outer block margins folded away. */
export const panelBody = style({});

// Markdown owns its own block margins; the first and last of them would push
// against the section around it.
globalStyle(`${panelBody} > :first-child`, { marginTop: 0 });
globalStyle(`${panelBody} > :last-child`, { marginBottom: 0 });

export const people = style({
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "flex",
	flexDirection: "column",
	gap: "2px",
});

/** The people search field: it takes the row, the button beside it does not. */
export const personSearch = style({
	flex: "1 1 auto",
	minWidth: 0,
});

/** One person in a search result: a quiet row that assigns on click. */
export const person = style({
	appearance: "none",
	border: "none",
	background: "transparent",
	font: "inherit",
	color: theme.color.link,
	textAlign: "left",
	padding: "4px 6px",
	borderRadius: theme.radius.sm,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: theme.color.hoverFill },
		"&:disabled": { color: theme.color.labelTertiary, cursor: "default" },
	},
});

export const comments = style({
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "flex",
	flexDirection: "column",
	gap: "12px",
});

export const comment = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	paddingLeft: "10px",
	borderLeft: `2px solid ${theme.color.borderSubtle}`,
});

export const commentHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
});

export const commentAuthor = style({
	fontSize: "12px",
	fontWeight: 600,
});

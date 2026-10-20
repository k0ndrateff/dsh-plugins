/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. The card material
 * and the type scale are the ones the harness uses for its settings cards, so a
 * plugin card is indistinguishable from a built-in one.
 *
 * vanilla-extract in this build accepts `&` with modifiers and a parent
 * selector, and nothing else; every element the card and the panel draw has a
 * class of its own rather than being reached through a descendant.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "./theme.css";

export const section = style({
	display: "flex",
	flexDirection: "column",
	gap: "16px",
	padding: "8px 0",
	fontSize: "13px",
	lineHeight: "22px",
	color: theme.color.labelPrimary,
});

export const card = style({
	padding: "12px 16px",
	border: `0.5px solid ${theme.color.cardStroke}`,
	borderRadius: theme.radius.xl,
	background: theme.color.cardFill,
});

export const head = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "12px",
	paddingBottom: "12px",
});

export const title = style({
	fontSize: "14px",
	fontWeight: 500,
});

export const badges = style({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	flexWrap: "wrap",
});

export const caption = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

export const actions = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
	marginTop: "12px",
});

export const row = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "16px",
	minHeight: "40px",
	padding: "6px 0",
	boxSizing: "border-box",
});

export const list = style({
	listStyle: "none",
	// The card's own `gap` is the only space between the heading and the list;
	// a margin here would double it.
	margin: 0,
	padding: 0,
	display: "grid",
	gap: "8px",
	selectors: {
		'&[data-layout="list"]': { gap: "6px" },
		// A card stays a card: past four rows it scrolls, and the heading says how
		// many items there are, so a long answer never buries the prose above it.
		'&[data-scrollable="true"]': {
			maxHeight: "360px",
			overflowY: "auto",
			overscrollBehavior: "contain",
			scrollbarGutter: "stable",
			paddingRight: "2px",
		},
	},
});

export const item = style({
	position: "relative",
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	padding: "8px 12px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
	selectors: {
		// One issue earns room: it is the whole answer, not a row in a list.
		[`${list}[data-layout="single"] &`]: {
			padding: "14px 16px",
			borderRadius: theme.radius.lg,
		},
		[`${list}[data-layout="list"] &`]: {
			padding: "6px 10px",
			borderRadius: theme.radius.sm,
		},
		// The whole row is the link, so hovering anywhere on it is the affordance.
		"&:has(a):hover": { background: theme.color.hoverFill },
		"&:has(button):hover": { background: theme.color.hoverFill },
	},
});

export const itemHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	flexWrap: "wrap",
	selectors: {
		[`${list}[data-layout="single"] &`]: { fontSize: "15px", fontWeight: 500 },
		[`${list}[data-layout="list"] &`]: { fontSize: "13px" },
	},
});

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

/**
 * The overlay that makes a whole row clickable.
 *
 * The issue id carries it, so one anchor — or one button, when Sentry named no
 * URL — covers the row: clicking the title, the badges, or the empty space
 * beside them all open the issue.
 */
export const itemLink = style({
	selectors: {
		"&::after": {
			content: '""',
			position: "absolute",
			inset: 0,
			borderRadius: "inherit",
		},
	},
});

/** The row's click target when there is no URL to anchor: a bare button. */
export const rowButton = style({
	appearance: "none",
	border: "none",
	background: "transparent",
	font: "inherit",
	padding: 0,
	cursor: "pointer",
});

export const link = style({
	color: theme.color.link,
	fontWeight: 500,
	textDecoration: "none",
	selectors: {
		"&:hover": {
			textDecoration: "underline",
			textDecorationStyle: "dotted",
			textUnderlineOffset: "3px",
		},
		"&:focus-visible": {
			textDecoration: "underline",
			textDecorationStyle: "dotted",
			textUnderlineOffset: "3px",
		},
	},
});

export const code = style({
	margin: "8px 0 0",
	padding: "10px",
	maxHeight: "260px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	fontFamily: theme.font.code,
	fontSize: "12px",
	lineHeight: 1.5,
	borderRadius: theme.radius.lg,
	background: theme.color.codeFill,
});

export const error = style({
	color: theme.color.danger,
});

/** The cards one turn contributes, stacked in call order. */
export const presentations = style({
	display: "flex",
	flexDirection: "column",
	gap: "12px",
	marginTop: "12px",
});

/** One presentation card: an optional heading over its items. */
export const presentation = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	padding: "12px 16px 14px",
	border: `0.5px solid ${theme.color.cardStroke}`,
	borderRadius: theme.radius.xl,
	background: theme.color.cardFill,
});

export const presentationHead = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	minHeight: "24px",
});

export const presentationTitle = style({
	fontSize: "13px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
});

/** How many items the card shows, and how many matched. */
export const presentationCount = style({
	marginLeft: "auto",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	whiteSpace: "nowrap",
});

/** The query the search ran, and the link to everything it matched. */
export const cardMeta = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
});

export const query = style({
	padding: "2px 6px",
	borderRadius: theme.radius.sm,
	background: theme.color.codeFill,
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelSecondary,
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

/** One monospace string: a commit sha, a file position, a raw id. */
export const mono = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

/** One Sentry tool call, rendered as a single terse line. */
export const toolRow = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
	minHeight: "24px",
});

export const toolName = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

/** The side panel: the pane's whole height, with one scrollport inside it. */
export const panel = style({
	display: "flex",
	flex: "1 1 auto",
	flexDirection: "column",
	height: "100%",
	minHeight: 0,
	color: theme.color.labelPrimary,
	background: theme.color.bgBase,
});

export const panelScroll = style({
	display: "flex",
	flex: "1 1 auto",
	flexDirection: "column",
	gap: "16px",
	minHeight: 0,
	padding: "12px 16px 24px",
	overflowY: "auto",
	overflowX: "hidden",
	fontSize: "13px",
	lineHeight: "20px",
});

export const panelHead = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
});

export const panelTitleRow = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
});

export const panelKey = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
});

export const panelSummary = style({
	margin: 0,
	fontSize: "15px",
	fontWeight: 600,
	lineHeight: "22px",
});

/** One titled block of the panel. */
export const panelSection = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
});

export const panelSectionTitle = style({
	fontSize: "11px",
	fontWeight: 600,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: theme.color.labelTertiary,
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

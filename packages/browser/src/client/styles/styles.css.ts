/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the panel shell, the terse tool row —
 * is re-exported from `dsh-integration-ui`, so this file holds only what the
 * browser's own panel draws: its head, its stage, its activity list, and the
 * footer that carries the two actions.
 *
 * vanilla-extract in this build accepts `&` with modifiers and a parent
 * selector, and nothing else; every element here has a class of its own rather
 * than being reached through a descendant.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** The panel's own column: the head above, the footer pinned below, the frame between. */
export const viewer = style({
	display: "flex",
	flex: "1 1 auto",
	flexDirection: "column",
	height: "100%",
	minHeight: 0,
	color: theme.color.labelPrimary,
	background: theme.color.bgBase,
});

export const viewerHead = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	padding: "12px 16px 10px",
	borderBottom: `0.5px solid ${theme.color.borderSubtle}`,
});

export const viewerTitleRow = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	minWidth: 0,
});

/** The page's name, which is what the reader came for; the address is beside it. */
export const viewerTitle = style({
	flex: "1 1 auto",
	minWidth: 0,
	margin: 0,
	fontSize: "14px",
	fontWeight: 600,
	lineHeight: "20px",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const viewerState = style({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	whiteSpace: "nowrap",
});

export const viewerUrl = style({
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	overflowWrap: "anywhere",
});

/** The three navigations, and the address they act on. */
export const viewerNavRow = style({
	display: "flex",
	alignItems: "center",
	gap: "2px",
	minWidth: 0,
});

/** The address on one line: the page's name is what matters, its query can wait. */
export const viewerAddress = style({
	flex: "1 1 auto",
	minWidth: 0,
	marginLeft: "4px",
	fontFamily: theme.font.code,
	fontSize: "11px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const viewerScroll = style({
	display: "flex",
	flex: "1 1 auto",
	flexDirection: "column",
	gap: "12px",
	minHeight: 0,
	padding: "12px 16px",
	overflowY: "auto",
	overflowX: "hidden",
});

/**
 * Where the viewport is drawn.
 *
 * A frame of its own, filled before the first picture arrives, so the panel does
 * not jump when one does.
 */
export const stage = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	minHeight: "140px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
	background: theme.color.codeFill,
	overflow: "hidden",
});

/** The viewport, scaled to the panel's width; its own aspect is the browser's. */
export const frame = style({
	display: "block",
	width: "100%",
	height: "auto",
});

/**
 * The picture as the page's own surface.
 *
 * A person's click, wheel and keys go through it, so it takes focus and says so
 * with a ring: a picture that swallows typing without showing that it has it is
 * how a keyboard disappears into nothing.
 */
export const surface = style({
	width: "100%",
	lineHeight: 0,
	outline: "none",
	cursor: "default",
	userSelect: "none",
	selectors: {
		"&:focus-visible": {
			outline: `2px solid ${theme.color.link}`,
			outlineOffset: "-2px",
		},
	},
});

/** What the stage says while it has no picture to show. */
export const placeholder = style({
	padding: "16px",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	textAlign: "center",
});

export const activity = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
});

export const activityTitle = style({
	fontSize: "11px",
	fontWeight: 600,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: theme.color.labelTertiary,
});

export const activityList = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	margin: 0,
	padding: 0,
	listStyle: "none",
});

/** One activity line: what happened on the left, how long it took on the right. */
export const activityItem = style({
	display: "flex",
	alignItems: "baseline",
	gap: "6px",
	fontSize: "12px",
	lineHeight: "18px",
	overflowWrap: "anywhere",
});

/** The verb: what the agent did, in a reader's words. */
export const activityLabel = style({
	flex: "1 1 auto",
	minWidth: 0,
	color: theme.color.labelSecondary,
});

/** What it acted on, kept apart from the verb so the sentence stays scannable. */
export const activityDetail = style({
	flex: "0 1 auto",
	minWidth: 0,
	fontFamily: theme.font.code,
	fontSize: "11px",
	color: theme.color.labelPrimary,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

/** How long it took, once it is known. */
export const activityDuration = style({
	flex: "0 0 auto",
	fontVariantNumeric: "tabular-nums",
	color: theme.color.labelTertiary,
});

/** What the stage says when a frame was there but would not load. */
export const frameMissing = style({
	padding: "16px",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.danger,
	textAlign: "center",
});

export const footer = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
	padding: "10px 16px 14px",
	borderTop: `0.5px solid ${theme.color.borderSubtle}`,
});

/** The page-size picker: a native select, because the list is a browser's own. */
export const pageSize = style({
	height: "28px",
	maxWidth: "160px",
	padding: "0 6px",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelSecondary,
	background: theme.color.bgBase,
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
	cursor: "pointer",
});

/** The host's own words about an action, or the reason it was not reached. */
export const answer = style({
	flex: "1 1 100%",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
	overflowWrap: "anywhere",
});

export const answerError = style({
	color: theme.color.danger,
});

/** The panel's state when it was opened without a browser to watch. */
export const empty = style({
	display: "flex",
	flex: "1 1 auto",
	alignItems: "center",
	justifyContent: "center",
	padding: "24px 16px",
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelTertiary,
	textAlign: "center",
});

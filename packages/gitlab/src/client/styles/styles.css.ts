/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the panel, the terse tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what is
 * GitLab's: a diff's file header, a discussion thread, the confirmation row, and
 * a job's log.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** A review finding's own words, clamped so one long note cannot fill the card. */
export const findingBody = style({
	display: "-webkit-box",
	WebkitBoxOrient: "vertical",
	WebkitLineClamp: 3,
	overflow: "hidden",
	fontSize: "12px",
	lineHeight: "18px",
	color: theme.color.labelSecondary,
});

/** The merge request's own heading block. */
export const mrHead = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
});

export const branchRow = style({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	flexWrap: "wrap",
});

export const branch = style({
	padding: "1px 6px",
	borderRadius: theme.radius.sm,
	background: theme.color.codeFill,
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

/** The description, as GitLab returned it in Markdown. */
export const description = style({
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

/** One changed file: its header, and the diff under it. */
export const diffFile = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
});

export const diffHead = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
});

export const diffPath = style({
	flex: "1 1 auto",
	minWidth: 0,
	overflowWrap: "anywhere",
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

export const added = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.success,
});

export const removed = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.danger,
});

/** One discussion thread. */
export const thread = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	padding: "10px 12px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
});

export const threadHead = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
});

export const threadFile = style({
	flex: "1 1 auto",
	minWidth: 0,
	overflowWrap: "anywhere",
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

/** One note of a thread. */
export const note = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	paddingLeft: "10px",
	borderLeft: `2px solid ${theme.color.borderSubtle}`,
});

export const noteHead = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	flexWrap: "wrap",
});

export const noteAuthor = style({
	fontSize: "12px",
	fontWeight: 600,
	color: theme.color.labelPrimary,
});

export const noteBody = style({
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

/** The composer and the confirmation row share one shape. */
export const draft = style({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	padding: "10px 12px",
	border: `0.5px solid ${theme.color.cardStroke}`,
	borderRadius: theme.radius.md,
	background: theme.color.codeFill,
});

export const draftText = style({
	margin: 0,
	whiteSpace: "pre-wrap",
	overflowWrap: "anywhere",
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelPrimary,
});

/** One CI job row. */
export const job = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	flexWrap: "wrap",
	padding: "6px 10px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.sm,
});

export const jobName = style({
	flex: "1 1 auto",
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	fontFamily: theme.font.code,
	fontSize: "12px",
});

/** A job's trace, with the escapes the server sent rendered as styles. */
export const log = style({
	margin: 0,
	padding: "10px",
	maxHeight: "420px",
	overflow: "auto",
	borderRadius: theme.radius.lg,
	background: theme.color.codeFill,
	fontFamily: theme.font.code,
	fontSize: "12px",
	lineHeight: 1.5,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
});

/** The thread a card opened the panel on, so the eye lands on it. */
export const threadFocused = style({
	border: `1px solid ${theme.color.link}`,
});

/** A short confirmation of what one write changed, under the thread it touched. */
export const notice = style({
	fontSize: "12px",
	color: theme.color.success,
});

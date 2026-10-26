/**
 * The plugin's stylesheet, authored in vanilla-extract.
 *
 * Every rule is compiled to static CSS at build time: the browser bundle carries
 * class names and the harness's own variables, nothing else. What every
 * integration draws — the card material, the panel, the terse tool row — is
 * re-exported from `dsh-integration-ui`, so this file holds only what is
 * Figma's: the frame's picture, its facts, its variables and its mapping.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** The picture's own stage: it scrolls when the picture is shown at full size. */
export const frameStage = style({
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	maxHeight: "70vh",
	overflow: "hidden",
});

export const frameStageZoomed = style({
	overflow: "auto",
});

/** The picture is a control: clicking it toggles fit and actual size. */
export const frameButton = style({
	display: "block",
	width: "100%",
	padding: 0,
	border: "none",
	background: "none",
	cursor: "zoom-in",
});

/** The frame's picture: fit to the panel's width, never taller than it is useful. */
export const frameImage = style({
	display: "block",
	width: "100%",
	maxHeight: "460px",
	objectFit: "contain",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
	background: theme.color.codeFill,
});

/** The same picture at its own size, which is how small labels become readable. */
export const frameImageZoomed = style({
	width: "auto",
	maxWidth: "none",
	maxHeight: "none",
	cursor: "zoom-out",
});

export const frameActions = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	gap: "8px",
	flexWrap: "wrap",
});

/** What stands in for the picture when the server sent none, with its reason. */
export const frameMissing = style({
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: "8px",
	justifyContent: "center",
	minHeight: "96px",
	padding: "12px",
	border: `0.5px dashed ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.md,
	fontSize: "12px",
	color: theme.color.labelTertiary,
});

export const frameMissingText = style({
	overflowWrap: "anywhere",
});

/** One layer of the node's structure; a button, because it opens that layer. */
export const layer = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	width: "100%",
	padding: "3px 4px",
	border: "none",
	background: "none",
	textAlign: "left",
	cursor: "pointer",
	selectors: {
		"&:hover": { background: theme.color.hoverFill },
	},
});

export const layerName = style({
	flex: "1 1 auto",
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

export const layerMeta = style({
	fontFamily: theme.font.code,
	fontSize: "11px",
	color: theme.color.labelTertiary,
});

/** One variable the node uses. */
export const token = style({
	display: "flex",
	alignItems: "baseline",
	gap: "8px",
	padding: "4px 0",
	borderBottom: `0.5px solid ${theme.color.borderSubtle}`,
});

export const tokenName = style({
	flex: "1 1 auto",
	minWidth: 0,
	overflowWrap: "anywhere",
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelSecondary,
});

export const tokenValue = style({
	flex: "0 1 auto",
	maxWidth: "50%",
	overflowWrap: "anywhere",
	textAlign: "right",
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

/** One Code Connect mapping. */
export const mapping = style({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	padding: "8px 10px",
	border: `0.5px solid ${theme.color.borderSubtle}`,
	borderRadius: theme.radius.sm,
});

export const mappingComponent = style({
	fontFamily: theme.font.code,
	fontSize: "12px",
	color: theme.color.labelPrimary,
});

export const mappingSource = style({
	overflowWrap: "anywhere",
	fontFamily: theme.font.code,
	fontSize: "11px",
	color: theme.color.labelSecondary,
});

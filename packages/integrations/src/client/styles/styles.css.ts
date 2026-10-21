/**
 * The Integrations page's stylesheet.
 *
 * The page chrome is the harness's own tabbed settings section, down to the
 * underline that marks the selected tab: a page a plugin contributes should be
 * indistinguishable from the one the product ships. Everything the cards
 * themselves draw is re-exported from `dsh-integration-ui`, so this file holds
 * only the heading, the strip, and the panel.
 *
 * Flat classes only: vanilla-extract in this build accepts `&` with modifiers
 * and nothing else, so every element gets a name here rather than being reached
 * through a parent selector.
 */

import { style } from "@vanilla-extract/css";
import { theme } from "dsh-integration-ui/styles";

export * from "dsh-integration-ui/styles";

/** The page's column, as wide as the harness lets a settings page be. */
export const section = style({
	display: "flex",
	flexDirection: "column",
	gap: "12px",
	maxWidth: "760px",
	color: theme.color.labelPrimary,
});

export const heading = style({
	margin: 0,
	fontSize: "18px",
	fontWeight: 600,
});

/** One sentence about what the page is for, under its heading. */
export const intro = style({
	margin: 0,
	fontSize: "13px",
	lineHeight: "18px",
	color: theme.color.labelTertiary,
});

export const empty = style({
	margin: 0,
	fontSize: "13px",
	color: theme.color.labelTertiary,
});

/** The strip: tabs on one baseline, sharing the hairline under them. */
export const tabs = style({
	display: "flex",
	alignItems: "flex-end",
	gap: "22px",
	marginTop: "2px",
	borderBottom: `0.5px solid ${theme.color.borderSubtle}`,
});

export const tab = style({
	position: "relative",
	padding: "7px 1px 9px",
	border: "none",
	background: "none",
	font: "inherit",
	fontSize: "13px",
	lineHeight: "20px",
	color: theme.color.labelTertiary,
	cursor: "pointer",
	selectors: {
		"&:hover": { color: theme.color.labelPrimary },
		"&[data-active='true']": { color: theme.color.labelPrimary },
		// The underline rides the hairline rather than sitting above it, which is
		// what makes the selected tab read as connected to its panel.
		"&[data-active='true']::after": {
			content: '""',
			position: "absolute",
			right: 0,
			bottom: "-1px",
			left: 0,
			height: "2px",
			borderRadius: "2px 2px 0 0",
			background: theme.color.labelPrimary,
		},
		"&:focus-visible": {
			// The harness's own focus ring, with its own fallbacks: a renamed token
			// degrades the ring rather than removing it.
			outline:
				"var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))",
			outlineOffset: "2px",
			borderRadius: theme.radius.sm,
			color: theme.color.labelPrimary,
		},
	},
});

/** One tab's body: the shared card, once it has loaded. */
export const panel = style({
	minWidth: 0,
	paddingTop: "2px",
});

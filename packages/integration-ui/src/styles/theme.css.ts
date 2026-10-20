/**
 * The harness's design tokens, as a typed contract.
 *
 * `createGlobalThemeContract` declares no values — the page already defines every
 * one of these variables. It maps a readable name onto the variable the harness
 * publishes and gives the styles a typed handle, so a typo becomes a build error
 * instead of a silently missing colour.
 *
 * Only `--dsw-*` semantic aliases are referenced, never literal colours, which
 * is what keeps the cards and the panel correct in both the light and the dark
 * theme.
 */

import { createGlobalThemeContract } from "@vanilla-extract/css";

export const theme = createGlobalThemeContract({
	radius: {
		/** H20-28 controls, and a dense row in a list. */
		sm: "dsw-radius-sm",
		/** H32-40 controls, compact rows. */
		md: "dsw-radius-md",
		/** Code blocks, diffs, nested cards. */
		lg: "dsw-radius-lg",
		/** One independent content card, including a settings card. */
		xl: "dsw-radius-xl",
	},
	color: {
		labelPrimary: "dsw-alias-label-primary",
		labelSecondary: "dsw-alias-label-secondary",
		labelTertiary: "dsw-alias-label-tertiary",
		cardFill: "dsw-alias-settings-card-fill",
		cardStroke: "dsw-alias-settings-card-stroke",
		borderSubtle: "dsw-alias-border-l2",
		/** The column behind a side panel, as the shell draws it. */
		bgBase: "dsw-alias-bg-base",
		hoverFill: "dsw-alias-interactive-bg-hover",
		link: "dsw-alias-link",
		codeFill: "dsw-alias-markdown-code-block",
		danger: "dsw-alias-state-error-primary",
		success: "dsw-alias-state-success-primary",
		warn: "dsw-alias-state-warn-primary",
	},
	font: {
		code: "ds-font-family-code",
	},
});

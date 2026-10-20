/**
 * The harness's design tokens, as a typed contract.
 *
 * `createGlobalThemeContract` declares no values — the page already defines every
 * one of these variables. It maps a readable name onto the variable the harness
 * publishes and gives the styles a typed handle, so a typo becomes a build error
 * instead of a silently missing colour.
 *
 * Only `--dsw-*` semantic aliases are referenced, never literal colours, which
 * is what keeps the card correct in both the light and the dark theme.
 */

import { createGlobalThemeContract } from "@vanilla-extract/css";

export const theme = createGlobalThemeContract({
	radius: {
		sm: "dsw-radius-sm",
		md: "dsw-radius-md",
		lg: "dsw-radius-lg",
	},
	color: {
		labelPrimary: "dsw-alias-label-primary",
		labelSecondary: "dsw-alias-label-secondary",
		labelTertiary: "dsw-alias-label-tertiary",
		cardFill: "dsw-alias-settings-card-fill",
		cardStroke: "dsw-alias-settings-card-stroke",
		borderSubtle: "dsw-alias-border-l2",
		hoverFill: "dsw-alias-interactive-bg-hover",
		codeFill: "dsw-alias-markdown-code-block",
		danger: "dsw-alias-state-error-primary",
		success: "dsw-alias-state-success-primary",
		warn: "dsw-alias-state-warn-primary",
		link: "dsw-alias-link",
	},
	font: {
		code: "ds-font-family-code",
	},
});

/**
 * Putting the compiled stylesheet into the page.
 *
 * vanilla-extract compiles `*.css.ts` to static CSS at build time, but the
 * client module system serves exactly one artifact — `client.js` — so there is
 * nowhere to put a stylesheet file. The build therefore compiles the CSS first
 * and substitutes its text for `__DSH_ATLASSIAN_STYLES__` here, which keeps the
 * bundle single-file with no style-injection runtime.
 *
 * The `data-plugin` tag is what the module system matches on when the plugin is
 * turned off, so the rules leave with it.
 */

import { PLUGIN_ID } from "../plugin-id";

/** Replaced with the compiled CSS text at build time. */
declare const __DSH_ATLASSIAN_STYLES__: string;

/**
 * Add the stylesheet to the document.
 * @returns a disposer that removes it again.
 */
export const installStyles = (): (() => void) => {
	const style = document.createElement("style");
	style.setAttribute("data-plugin", PLUGIN_ID);
	style.textContent = __DSH_ATLASSIAN_STYLES__;

	document.head.append(style);

	return () => style.remove();
};

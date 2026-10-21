/**
 * Putting the compiled stylesheet into the page.
 *
 * The mechanism belongs to `dsh-integration-ui`; what stays here is this
 * plugin's own placeholder, because the client module system serves exactly one
 * artifact per package and the build substitutes the compiled CSS text into it.
 */

import { installStyles } from "dsh-integration-ui";
import { PLUGIN_ID } from "../plugin-id";

/** Replaced with the compiled CSS text at build time. */
declare const __DSH_DIGEST_STYLES__: string;

/**
 * Add the plugin's stylesheet to the document.
 * @returns a disposer that removes it again.
 */
export const installDigestStyles = (): (() => void) =>
	installStyles(PLUGIN_ID, __DSH_DIGEST_STYLES__);

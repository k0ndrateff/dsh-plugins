/**
 * Putting the compiled stylesheet into the page.
 *
 * The mechanism belongs to `dsh-integration-ui`, and the placeholder the build
 * substitutes the compiled CSS for belongs to `dsh-plugin-build`; what stays
 * here is this plugin's own id, which is what the module system matches when the
 * plugin is turned off.
 */

import { installStyles } from "dsh-integration-ui";
import { PLUGIN_ID } from "../plugin-id";

/** Replaced with the compiled CSS text at build time. */
declare const __DSH_STYLES__: string;

/**
 * Add the plugin's stylesheet to the document.
 * @returns a disposer that removes it again.
 */
export const installDevkitStyles = (): (() => void) =>
	installStyles(PLUGIN_ID, __DSH_STYLES__);

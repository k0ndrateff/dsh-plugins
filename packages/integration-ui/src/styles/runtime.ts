/**
 * Putting a plugin's compiled stylesheet into the page.
 *
 * vanilla-extract compiles `*.css.ts` to static CSS at build time, but the
 * client module system serves exactly one artifact per package, so there is
 * nowhere to put a stylesheet file. Each plugin's build compiles its CSS first
 * and substitutes its text for its own placeholder, then hands it here.
 *
 * The `data-plugin` tag is what the module system matches on when the plugin is
 * turned off, so the rules leave with it.
 */

/**
 * Add one plugin's stylesheet to the document.
 * @param pluginId - the plugin the rules belong to.
 * @param css - the compiled stylesheet.
 * @returns a disposer that removes it again.
 */
export const installStyles = (pluginId: string, css: string): (() => void) => {
	const style = document.createElement("style");
	style.setAttribute("data-plugin", pluginId);
	style.textContent = css;

	document.head.append(style);

	return () => style.remove();
};

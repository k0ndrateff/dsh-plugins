/**
 * The wire names both halves agree on.
 *
 * The host half registers these tools and the browser half keys its tool row on
 * the same names, so the two cannot drift apart the way a string repeated in two
 * bundles does.
 */

/** Open a URL in this session's browser. */
export const BROWSER_OPEN_TOOL = "browser_open";

/** Read the page's accessibility tree with its `@eN` references. */
export const BROWSER_SNAPSHOT_TOOL = "browser_snapshot";

/** Act on one element: click, fill, press, select, hover, scroll, wait. */
export const BROWSER_ACT_TOOL = "browser_act";

/** Read the page text, the console, or the errors the page threw. */
export const BROWSER_READ_TOOL = "browser_read";

/** Run any other agent-browser command in this session's browser. */
export const BROWSER_RUN_TOOL = "browser_run";

/** Take a picture of the page, as an image the model can look at. */
export const BROWSER_SCREENSHOT_TOOL = "browser_screenshot";

/** Close this conversation's browser. */
export const BROWSER_CLOSE_TOOL = "browser_close";

/**
 * The browser tools, in the order a session meets them.
 *
 * Opening, seeing, acting, reading, the escape hatch, a picture when the visual
 * result matters, and the close that ends the work: the composition root
 * registers this list and owns nothing else about them.
 */

import { actTool } from "./act";
import { closeTool } from "./close";
import type { BrowserTool } from "./deps";
import { openTool } from "./open";
import { readTool } from "./read";
import { runTool } from "./run";
import { screenshotTool } from "./screenshot";
import { snapshotTool } from "./snapshot";

export const browserTools: readonly BrowserTool[] = [
	openTool,
	snapshotTool,
	actTool,
	readTool,
	runTool,
	screenshotTool,
	closeTool,
];

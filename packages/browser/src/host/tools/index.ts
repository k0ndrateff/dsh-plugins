/**
 * The browser tools, in the order a session meets them.
 *
 * Opening, seeing, acting, reading, and the escape hatch: the composition root
 * registers this list and owns nothing else about them.
 */

import { actTool } from "./act";
import type { BrowserTool } from "./deps";
import { openTool } from "./open";
import { readTool } from "./read";
import { runTool } from "./run";
import { snapshotTool } from "./snapshot";

export const browserTools: readonly BrowserTool[] = [
	openTool,
	snapshotTool,
	actTool,
	readTool,
	runTool,
];

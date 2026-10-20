/**
 * Opening the user's browser. Sign-in is impossible without a human in a
 * browser, so this is best-effort: a failure costs one copy-paste from the
 * notice the flow already published.
 */

import { execFile } from "node:child_process";
import type { Context } from "@deepseek-ai/cordis";
import { errorText, loggerOf } from "./log";

/** Launch the platform's default browser on a URL. */
export function openBrowser(ctx: Context, url: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";

	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

	execFile(command, args, (error) => {
		if (error !== null)
			loggerOf(ctx).warn(
				"[mcp-oauth] could not open a browser: %s",
				errorText(error),
			);
	});
}

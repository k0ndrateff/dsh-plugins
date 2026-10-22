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
				? "rundll32"
				: "xdg-open";

	// `cmd /c start` treats an unquoted `&` in the authorize URL as a command
	// separator, and Node's argv quoting does not add quotes without a space.
	// rundll32 opens the URL without a shell in between.
	const args =
		process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];

	execFile(command, args, (error) => {
		if (error !== null)
			loggerOf(ctx).warn(
				"[mcp-oauth] could not open a browser: %s",
				errorText(error),
			);
	});
}

/**
 * dsh-browser — a browser for the agent, one per session.
 *
 * An agent working on a UI has to check its own work: open the page it just
 * changed, see what is on it, click the thing it added, and read what the
 * browser reports. Without a browser that decision is made anew every time.
 *
 * This host half gives that loop one road. It drives the machine's own
 * `agent-browser` CLI — a real headless Chrome over CDP — through the subprocess
 * seam, and every call is pinned to the calling session's own browser.
 *
 * This module is the composition root: it builds the runner and the session
 * scope, and registers the tools and the command against the context they run
 * in. There is no browser half yet: the live viewport is the next milestone, and
 * the design is in `docs/browser.md`.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools`,
// `ctx.commands`, `ctx.subprocess` and `ctx.workingDirectory` are declared by
// the packages that own them, not by cordis itself.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-subprocess";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-working-directory";
import { browserCommand } from "./command";
import { type ConfigInput, resolveConfig } from "./config";
import { AgentBrowserRunner } from "./runner";
import { SessionScope } from "./session";
import { browserTools } from "./tools/index";

export const name = "dsh-browser";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "commands", "subprocess", "workingDirectory"];

/**
 * @param ctx - host context carrying tools, commands, the subprocess seam and
 *   the session working directory.
 * @param configInput - the executable, the caps and the two CLI switches.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const runner = new AgentBrowserRunner({ ctx, config });
	const deps = { runner, sessions: new SessionScope(ctx), config };

	for (const tool of browserTools) ctx.tools.register(tool.create(deps));

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: browserCommand.COMMAND_NAME,
		description: "Browser: status | close",
		input: { hint: "status | close" },
		handler: browserCommand.create(deps),
	});
}

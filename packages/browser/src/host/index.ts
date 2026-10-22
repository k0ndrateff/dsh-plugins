/**
 * dsh-browser — a browser for the agent, one per session.
 *
 * An agent working on a UI has to check its own work: open the page it just
 * changed, see what is on it, click the thing it added, and read what the
 * browser reports. Without a browser that decision is made anew every time.
 *
 * This host half gives that loop one road. It drives the machine's own
 * `agent-browser` CLI — a real headless Chrome over CDP — through the subprocess
 * seam, every call is pinned to the calling session's own browser, and the same
 * browser is what the page half draws in the harness's side panel.
 *
 * This module is the composition root: it builds the runner, the session scope
 * and the hubs the panel reads, then registers the tools, the command and the
 * panel route against the context they run in.
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
import { mountPanel } from "./panel/route";
import { AgentBrowserRunner } from "./runner";
import { SessionScope } from "./session";
import { connectStream } from "./stream/connect";
import { askStreamStatus } from "./stream/facts";
import { StreamHub } from "./stream/hub";
import { StreamHubs } from "./stream/hubs";
import { askPageSize } from "./stream/page";
import { browserTools } from "./tools/index";
import { withHumanNotice } from "./tools/notice";

export const name = "dsh-browser";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "commands", "subprocess", "workingDirectory"];

/** How long the CLI may take to say where a session's screencast listens. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * @param ctx - host context carrying tools, commands, the subprocess seam and
 *   the session working directory.
 * @param configInput - the executable, the caps, the policy and the live view's
 *   own scale.
 */
export function apply(ctx: Context, configInput?: ConfigInput): void {
	const config = resolveConfig(configInput);
	const runner = new AgentBrowserRunner({ ctx, config });
	const hubs = new StreamHubs(
		(session) =>
			new StreamHub({
				session,
				port: async () =>
					(
						await askStreamStatus(runner, {
							session,
							cwd: process.cwd(),
							signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
						})
					)?.port,
				page: async () =>
					askPageSize(runner, {
						session,
						cwd: process.cwd(),
						signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
					}),
				connect: (port, handlers) => connectStream(port, handlers),
				maxFps: config.streamMaxFps,
			}),
	);
	const deps = { runner, sessions: new SessionScope(ctx), config, hubs };

	// Every result carries what the person at the panel did since the last one:
	// the agent and the human drive the same page, and only one of them knows it.
	for (const tool of browserTools)
		ctx.tools.register(withHumanNotice(tool.create(deps), hubs));

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: browserCommand.COMMAND_NAME,
		description: "Browser: status | close",
		input: { hint: "status | close" },
		handler: browserCommand.create(deps),
	});

	mountPanel(ctx, { hubs, runner });

	// Whatever is still watching goes away with the plugin, and with it the
	// connection to the browser's screencast.
	ctx.effect(() => () => hubs.stop(), "browser: live views");
}

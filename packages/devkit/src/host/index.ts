/**
 * dsh-devkit — the project's own checks for DeepSeek Harness.
 *
 * The plugin is a bundle: this host half runs the recipes a project wrote in
 * `dsh-checks.json` through the harness's own shell seam and answers with one
 * structured result per recipe, while `lib/client.js` contributes the tool row
 * and the card that show the user what failed.
 *
 * This module is the composition root: it builds the runner and registers the
 * tool and the command against the context they run in.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each of these brings a service declaration into this program: `ctx.tools`,
// `ctx.commands`, `ctx.shell`, `ctx.fs`, and `ctx.workingDirectory` are declared
// by the packages that own them, not by cordis itself.
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-fs";
import type {} from "@deepseek-ai/dsh-shell";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-working-directory";
import { checkCommand } from "./command";
import { RecipeRunner } from "./runner";
import { checkTool } from "./tool";

export const name = "dsh-devkit";

/** Services this plugin needs before it can activate. */
export const inject = ["tools", "commands", "shell", "fs", "workingDirectory"];

/**
 * @param ctx - host context carrying tools, commands, the shell seam, the
 *   filesystem seam, and the session working directory.
 */
export function apply(ctx: Context): void {
	const runner = new RecipeRunner(ctx);

	ctx.tools.register(checkTool.create({ ctx, runner }));

	// The command registration belongs to this plugin's Cordis fiber, so it is
	// withdrawn with the plugin.
	ctx.commands.register({
		name: checkCommand.COMMAND_NAME,
		description: "Project checks: list the recipes, or init to draft them",
		input: { hint: "init" },
		handler: checkCommand.create({ ctx }),
	});
}

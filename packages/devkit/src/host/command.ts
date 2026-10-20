/**
 * The `/checks` slash command.
 *
 * A command runs against the agent without a model message, which makes it the
 * human's side of the same book the `checks` tool reads: `/checks` shows what
 * the project configured, and `/checks init` drafts a book from the project's
 * own `package.json`. Neither writes anything.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import { CONFIG_FILE, RecipeBook } from "./config";
import { draftRecipes, runnerFor } from "./draft";
import { ProjectDirectory } from "./files";
import { errorText } from "./text";

/** What the command accepts after its name. */
const ACTIONS = ["init", "list"] as const;
type Action = (typeof ACTIONS)[number];

/** What the command needs from the plugin. */
export interface CheckCommandDeps {
	readonly ctx: Context;
}

class CheckCommand {
	/** The command's name, without the leading slash. */
	readonly COMMAND_NAME = "checks";

	/**
	 * Build the command handler.
	 * @param deps - host context, for the filesystem and working directory.
	 */
	create = (
		deps: CheckCommandDeps,
	): ((invocation: CommandInvocation) => Promise<CommandResult>) => {
		return async (invocation) => {
			const project = new ProjectDirectory(
				deps.ctx,
				await deps.ctx.workingDirectory.ensure(
					invocation.agent,
					invocation.signal,
				),
			);

			try {
				return this.parseAction(invocation.rawInput) === "init"
					? await this.init(project)
					: await this.list(project);
			} catch (error) {
				return { kind: "error", text: `checks: ${errorText(error)}` };
			}
		};
	};

	/** The recipe book the project has, or what to do about not having one. */
	private async list(project: ProjectDirectory): Promise<CommandResult> {
		let book: RecipeBook;

		try {
			book = await RecipeBook.read(project);
		} catch (error) {
			return {
				kind: "success",
				text: `${errorText(error)}\n/checks init drafts one from package.json.`,
			};
		}

		const width = Math.max(...book.names.map((name) => name.length));

		return {
			kind: "success",
			text: [
				`Checks in ${CONFIG_FILE}:`,
				...book.recipes.map(
					(recipe) =>
						`  ${recipe.name.padEnd(width)}  ${recipe.run}  (${recipe.parser})`,
				),
				"Run one with the `checks` tool, or all of them with `checks all`.",
			].join("\n"),
		};
	}

	/** Draft a book from the project's own scripts, without writing it. */
	private async init(project: ProjectDirectory): Promise<CommandResult> {
		const manifest = await project.read("package.json");

		if (manifest === undefined)
			return {
				kind: "error",
				text: `checks: no package.json in ${project.cwd}`,
			};

		let document: unknown;

		try {
			document = JSON.parse(manifest);
		} catch (error) {
			return {
				kind: "error",
				text: `checks: package.json is not valid JSON: ${errorText(error)}`,
			};
		}

		const draft = draftRecipes(
			document,
			await runnerFor(async (name) => await project.has(name)),
		);

		if (draft === undefined)
			return {
				kind: "success",
				text: "checks: package.json has no scripts that look like checks.",
			};

		return {
			kind: "success",
			text: [
				`Draft from package.json — save it as ${CONFIG_FILE} and edit what it got wrong:`,
				JSON.stringify(draft, null, 2),
			].join("\n"),
		};
	}

	/** The action asked for; anything unrecognized lists the book. */
	private parseAction(rawInput: unknown): Action {
		const first =
			String(rawInput ?? "")
				.trim()
				.split(/\s+/u)[0] ?? "";

		return (ACTIONS as readonly string[]).includes(first)
			? (first as Action)
			: "list";
	}
}

export const checkCommand = new CheckCommand();

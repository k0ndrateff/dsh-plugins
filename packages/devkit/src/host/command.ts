/**
 * The `/checks` slash command.
 *
 * A command runs against the agent without a model message, which makes it the
 * human's side of the same book the `checks` tool reads: `/checks` shows what
 * the project configured, and `/checks init` drafts a book from the project's
 * own `package.json`. Neither writes anything.
 *
 * A book that is missing or malformed is an error, not a list: the command that
 * answers "here is what is configured" has to be able to fail, or a user cannot
 * tell a project with no checks from one whose checks it just read.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {
	CommandInvocation,
	CommandResult,
} from "@deepseek-ai/dsh-commands";
import { durationLabel } from "../shared/checks";
import { CONFIG_FILE, type Recipe, RecipeBook } from "./config";
import { CHECK_WORDS, draftRecipes, runnerFor, skippedScripts } from "./draft";
import { ProjectDirectory } from "./files";
import { errorText } from "./text";

/** What the command accepts after its name. */
const ACTIONS = ["init", "list"] as const;
type Action = (typeof ACTIONS)[number];

/** The actions, as a refusal lists them. */
const USAGE = "/checks list (the default) or /checks init";

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
			try {
				const project = new ProjectDirectory(
					deps.ctx,
					await deps.ctx.workingDirectory.ensure(
						invocation.agent,
						invocation.signal,
					),
				);
				const action = this.parseAction(invocation.rawInput);

				if (action === undefined)
					return {
						kind: "error",
						text: `"/checks ${firstWord(invocation.rawInput)}" is not an action. Use ${USAGE}.`,
					};

				return action === "init"
					? await this.init(project)
					: await this.list(project);
			} catch (error) {
				return { kind: "error", text: `checks: ${errorText(error)}` };
			}
		};
	};

	/**
	 * The recipe book the project has, or what to do about not having one.
	 *
	 * The directory and a recipe's own deadline are printed with the book: in a
	 * monorepo the former is what tells one package's checks from another's, and
	 * the latter is what makes a "timed out" answer explain itself.
	 */
	private async list(project: ProjectDirectory): Promise<CommandResult> {
		let book: RecipeBook;

		try {
			book = await RecipeBook.read(project);
		} catch (error) {
			return {
				kind: "error",
				text: `${errorText(error)}\n/checks init drafts one from package.json.`,
			};
		}

		const width = Math.max(...book.names.map((name) => name.length));

		return {
			kind: "success",
			text: [
				`Checks in ${project.cwd}/${CONFIG_FILE}:`,
				...book.recipes.map((recipe) => this.line(recipe, width)),
				"Run one with the `checks` tool, or all of them with `checks all`.",
			].join("\n"),
		};
	}

	/** One recipe, with the parser that reads it and its own deadline. */
	private line(recipe: Recipe, width: number): string {
		const notes = [
			recipe.parser,
			recipe.timeoutMs === undefined
				? undefined
				: `timeout ${durationLabel(recipe.timeoutMs)}`,
		].filter(Boolean);

		return `  ${recipe.name.padEnd(width)}  ${recipe.run}  (${notes.join(", ")})`;
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
				text: [
					"checks: package.json has no scripts that look like checks.",
					`A script counts when its name mentions ${CHECK_WORDS.join(", ")}.`,
					`This manifest has: ${skippedScripts(document).join(", ") || "no scripts"}.`,
				].join("\n"),
			};

		return {
			kind: "success",
			text: [
				`Draft from package.json — save it as ${CONFIG_FILE} and edit what it got wrong:`,
				JSON.stringify(draft, null, 2),
			].join("\n"),
		};
	}

	/**
	 * The action asked for.
	 * @returns `list` for no word at all, or undefined when the word is not one.
	 */
	private parseAction(rawInput: unknown): Action | undefined {
		const first = firstWord(rawInput);

		if (first === "") return "list";

		return (ACTIONS as readonly string[]).includes(first)
			? (first as Action)
			: undefined;
	}
}

/** The first word of what the user typed after the command's name. */
function firstWord(rawInput: unknown): string {
	return (
		String(rawInput ?? "")
			.trim()
			.split(/\s+/u)
			.find((word) => word !== "") ?? ""
	);
}

export const checkCommand = new CheckCommand();

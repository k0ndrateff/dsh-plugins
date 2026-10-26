/**
 * The project's recipe book: `dsh-checks.json` in the directory the session
 * works in.
 *
 * The recipes belong to the project rather than to the agent or to the profile,
 * because the model may only name one — never write a command — so what runs is
 * what the repository already agreed on. The file is read on every call, so an
 * edit takes effect on the next check without a restart.
 */

import { isRecord } from "dsh-integration-host/shape";
import { isParserName, PARSER_NAMES, type ParserName } from "../shared/checks";
import type { ProjectDirectory } from "./files";
import { errorText } from "./text";

/** The file a project keeps its recipes in, relative to the session's directory. */
export const CONFIG_FILE = "dsh-checks.json";

/** The name a call uses to ask for every recipe, in config order. */
export const ALL_RECIPES = "all";

/** One named command the project agreed to run. */
export interface Recipe {
	/** The name the model asks for. */
	readonly name: string;
	/** The command line, as the project wrote it; the shell seam runs it. */
	readonly run: string;
	readonly parser: ParserName;
	/** Deadline for this recipe alone; absent uses the runner's default. */
	readonly timeoutMs?: number;
}

/**
 * Parse one config document.
 * @param document - the parsed JSON of a `dsh-checks.json`.
 * @param where - the file's path, for the error messages.
 * @throws when the document is not a recipe book, naming what is wrong.
 */
export function parseRecipes(document: unknown, where: string): Recipe[] {
	if (!isRecord(document) || !isRecord(document.checks))
		throw new Error(`${where} must be an object with a "checks" object`);

	const recipes: Recipe[] = [];

	for (const [name, value] of Object.entries(document.checks)) {
		if (name === "") throw new Error(`${where} has a check without a name`);

		if (!isRecord(value))
			throw new Error(`${where}: check "${name}" must be an object`);

		const run = value.run;

		if (typeof run !== "string" || run === "")
			throw new Error(`${where}: check "${name}" needs a non-empty "run"`);

		const parser = value.parse ?? "generic";

		if (typeof parser !== "string" || !isParserName(parser))
			throw new Error(
				`${where}: check "${name}" names an unknown parser; known ones are ${PARSER_NAMES.join(", ")}`,
			);

		const timeoutMs = Number(value.timeoutMs);

		recipes.push({
			name,
			run,
			parser,
			...(Number.isFinite(timeoutMs) && timeoutMs > 0
				? { timeoutMs: Math.floor(timeoutMs) }
				: {}),
		});
	}

	if (recipes.length === 0) throw new Error(`${where} lists no checks`);

	return recipes;
}

/** The recipes a project configured, in the order it wrote them. */
export class RecipeBook {
	/** The recipes, in config order. */
	readonly recipes: readonly Recipe[];

	private constructor(recipes: readonly Recipe[]) {
		this.recipes = recipes;
	}

	/**
	 * Read the project's recipe book.
	 * @param project - the directory the session works in.
	 * @throws when the file is missing, unreadable, or not a recipe book.
	 */
	static async read(project: ProjectDirectory): Promise<RecipeBook> {
		const text = await project.read(CONFIG_FILE);

		if (text === undefined)
			throw new Error(
				`no ${CONFIG_FILE} in ${project.cwd}; a project owns its checks, so the file has to exist before anything can run. The user can run /checks init to draft one from package.json, or you can write ${CONFIG_FILE} with a "checks" object naming each recipe's "run" command`,
			);

		let document: unknown;

		try {
			document = JSON.parse(text);
		} catch (error) {
			throw new Error(`${CONFIG_FILE} is not valid JSON: ${errorText(error)}`);
		}

		return new RecipeBook(parseRecipes(document, CONFIG_FILE));
	}

	/** Every recipe's name, in config order. */
	get names(): readonly string[] {
		return this.recipes.map((recipe) => recipe.name);
	}

	/** The recipe with this name, or undefined. */
	recipe(name: string): Recipe | undefined {
		return this.recipes.find((recipe) => recipe.name === name);
	}

	/**
	 * The recipes one call asked for.
	 * @param name - a recipe name, {@link ALL_RECIPES}, or undefined for all.
	 * @throws when no recipe has that name, listing the ones that exist.
	 */
	select(name: string | undefined): readonly Recipe[] {
		if (name === undefined || name === "" || name === ALL_RECIPES)
			return this.recipes;

		const recipe = this.recipe(name);

		if (recipe === undefined)
			throw new Error(
				`no check named "${name}"; this project has: ${this.names.join(", ")}`,
			);

		return [recipe];
	}
}

/**
 * The recipe book: what a project may write, what happens when it writes
 * something else, and what `/checks init` drafts from a `package.json`.
 *
 *   bun run test/config.ts
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	ALL_RECIPES,
	CONFIG_FILE,
	parseRecipes,
	RecipeBook,
} from "../src/host/config";
import { draftRecipes, parserFor, runnerFor } from "../src/host/draft";
import { ProjectDirectory } from "../src/host/files";
import { check, report, section } from "./harness";

/** A context whose filesystem serves one in-memory project. */
function project(files: Record<string, string>): ProjectDirectory {
	const ctx = {
		fs: {
			resolve: async (path: string) => ({ path }),
			stat: async (target: { path: string }) =>
				files[target.path] === undefined ? undefined : {},
			readText: async (target: { path: string }) => files[target.path] ?? "",
		},
	} as unknown as Context;

	return new ProjectDirectory(ctx, "/work/app");
}

/** The message a call throws, or a note that it did not. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();

		return "";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

const BOOK = JSON.stringify({
	checks: {
		typecheck: { run: "bun run typecheck", parse: "tsc" },
		test: { run: "bun run test", parse: "vitest", timeoutMs: 120_000 },
		build: { run: "bun run build" },
	},
});

section("a valid book");
{
	const recipes = parseRecipes(JSON.parse(BOOK), CONFIG_FILE);

	check(
		"keeps the order the project wrote",
		recipes.map((recipe) => recipe.name).join(",") === "typecheck,test,build",
		recipes.map((recipe) => recipe.name).join(","),
	);
	check(
		"a recipe without a parser is read by the exit code",
		recipes[2]?.parser === "generic",
		recipes[2]?.parser,
	);
	check(
		"a recipe's own deadline is kept",
		recipes[1]?.timeoutMs === 120_000,
		String(recipes[1]?.timeoutMs),
	);
	check(
		"a recipe without a deadline has none",
		recipes[0]?.timeoutMs === undefined,
	);
}

section("a book that is not one");
{
	const cases: [string, unknown][] = [
		["not an object", 42],
		["no checks", {}],
		["no checks", { checks: {} }],
		["a check that is not an object", { checks: { test: "bun test" } }],
		["a check without a command", { checks: { test: { parse: "tsc" } } }],
		["an empty command", { checks: { test: { run: "" } } }],
		[
			"an unknown parser",
			{ checks: { test: { run: "bun test", parse: "mocha" } } },
		],
	];

	for (const [what, document] of cases) {
		let message = "";

		try {
			parseRecipes(document, CONFIG_FILE);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		check(
			`${what} is refused with a message that names the file`,
			message.includes(CONFIG_FILE),
			message,
		);
	}

	check(
		"an unknown parser lists the known ones",
		(() => {
			try {
				parseRecipes({ checks: { t: { run: "x", parse: "mocha" } } }, "f.json");

				return false;
			} catch (error) {
				return String(error).includes("vitest");
			}
		})(),
	);
}

section("reading the book");
{
	const book = await RecipeBook.read(project({ [CONFIG_FILE]: BOOK }));

	check(
		"the project's names come back in order",
		book.names.join(",") === "typecheck,test,build",
		book.names.join(","),
	);
	check(
		"asking for all runs every recipe",
		book.select(ALL_RECIPES).length === 3 &&
			book.select(undefined).length === 3,
	);
	check(
		"asking for one runs one",
		book
			.select("test")
			.map((recipe) => recipe.name)
			.join(",") === "test",
	);

	const unknown = await refusal(async () => book.select("nope"));

	check(
		"an unknown recipe is refused with the ones that exist",
		unknown.includes("nope") && unknown.includes("typecheck"),
		unknown,
	);

	const missing = await refusal(async () =>
		RecipeBook.read(project({ "package.json": "{}" })),
	);

	check(
		"a project without a book says how to get one",
		missing.includes(CONFIG_FILE) && missing.includes("/checks init"),
		missing,
	);

	const broken = await refusal(async () =>
		RecipeBook.read(project({ [CONFIG_FILE]: "{ not json" })),
	);

	check(
		"a book that is not JSON is refused as such",
		broken.includes("not valid JSON"),
		broken,
	);
}

section("the /checks init draft");
{
	check(
		"a script that runs a known tool is read by that tool's parser",
		parserFor("verify", "bunx vitest run") === "vitest" &&
			parserFor("verify", "jest") === "jest" &&
			parserFor("verify", "pytest -q") === "pytest" &&
			parserFor("verify", "tsc --noEmit") === "tsc" &&
			parserFor("verify", "biome check") === "biome" &&
			parserFor("verify", "eslint .") === "eslint",
		[
			parserFor("verify", "bunx vitest run"),
			parserFor("verify", "jest"),
			parserFor("verify", "pytest -q"),
		].join(","),
	);
	check(
		"a name that sounds like a check is a fallback, not a guess",
		parserFor("typecheck", "node scripts/types.mjs") === "tsc" &&
			parserFor("lint", "node scripts/style.mjs") === "biome" &&
			parserFor("build", "node scripts/build.mjs") === "generic",
		parserFor("build", "node scripts/build.mjs"),
	);
	check(
		"the lockfile decides how the project runs its scripts",
		(await runnerFor(async (name) => name === "pnpm-lock.yaml")) === "pnpm" &&
			(await runnerFor(async (name) => name === "bun.lock")) === "bun" &&
			(await runnerFor(async () => false)) === "npm",
	);

	const draft = draftRecipes(
		{
			scripts: {
				typecheck: "tsc --noEmit",
				test: "vitest run",
				lint: "biome check",
				dev: "vite",
				start: "node .",
			},
		},
		"bun",
	);

	check(
		"only the check-shaped scripts are drafted",
		Object.keys(draft?.checks ?? {}).join(",") === "typecheck,test,lint",
		Object.keys(draft?.checks ?? {}).join(","),
	);
	check(
		"a drafted recipe runs the project's own script",
		draft?.checks.typecheck?.run === "bun run typecheck",
		draft?.checks.typecheck?.run,
	);
	check(
		"a drafted recipe names the parser it guessed",
		draft?.checks.test?.parse === "vitest",
		draft?.checks.test?.parse,
	);
	check(
		"a manifest with nothing to check drafts nothing",
		draftRecipes({ scripts: { dev: "vite" } }, "npm") === undefined &&
			draftRecipes({}, "npm") === undefined &&
			draftRecipes(null, "npm") === undefined,
	);
}

report();

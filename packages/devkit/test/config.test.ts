/**
 * The recipe book: what a project may write, what happens when it writes
 * something else, and what `/checks init` drafts from a `package.json`.
 *
 *   bun run test/config.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import {
	ALL_RECIPES,
	CONFIG_FILE,
	parseRecipes,
	RecipeBook,
} from "../src/host/config";
import { draftRecipes, parserFor, runnerFor } from "../src/host/draft";
import { ProjectDirectory } from "../src/host/files";

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

test("a valid book", async () => {
	{
		const recipes = parseRecipes(JSON.parse(BOOK), CONFIG_FILE);

		expect(
			recipes.map((recipe) => recipe.name).join(",") === "typecheck,test,build",
			`keeps the order the project wrote — ${recipes.map((recipe) => recipe.name).join(",")}`,
		).toBe(true);
		expect(
			recipes[2]?.parser === "generic",
			`a recipe without a parser is read by the exit code — ${recipes[2]?.parser}`,
		).toBe(true);
		expect(
			recipes[1]?.timeoutMs === 120_000,
			`a recipe's own deadline is kept — ${String(recipes[1]?.timeoutMs)}`,
		).toBe(true);
		expect(
			recipes[0]?.timeoutMs === undefined,
			"a recipe without a deadline has none",
		).toBe(true);
	}
});
test("a book that is not one", async () => {
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

			expect(
				message.includes(CONFIG_FILE),
				String(`${what} is refused with a message that names the file`) +
					" — " +
					message,
			).toBe(true);
		}

		expect(
			(() => {
				try {
					parseRecipes(
						{ checks: { t: { run: "x", parse: "mocha" } } },
						"f.json",
					);

					return false;
				} catch (error) {
					return String(error).includes("vitest");
				}
			})(),
			"an unknown parser lists the known ones",
		).toBe(true);
	}
});
test("reading the book", async () => {
	{
		const book = await RecipeBook.read(project({ [CONFIG_FILE]: BOOK }));

		expect(
			book.names.join(",") === "typecheck,test,build",
			`the project's names come back in order — ${book.names.join(",")}`,
		).toBe(true);
		expect(
			book.select(ALL_RECIPES).length === 3 &&
				book.select(undefined).length === 3,
			"asking for all runs every recipe",
		).toBe(true);
		expect(
			book
				.select("test")
				.map((recipe) => recipe.name)
				.join(",") === "test",
			"asking for one runs one",
		).toBe(true);

		const unknown = await refusal(async () => book.select("nope"));

		expect(
			unknown.includes("nope") && unknown.includes("typecheck"),
			`an unknown recipe is refused with the ones that exist — ${unknown}`,
		).toBe(true);

		const missing = await refusal(async () =>
			RecipeBook.read(project({ "package.json": "{}" })),
		);

		expect(
			missing.includes(CONFIG_FILE) && missing.includes("/checks init"),
			`a project without a book says how to get one — ${missing}`,
		).toBe(true);

		const broken = await refusal(async () =>
			RecipeBook.read(project({ [CONFIG_FILE]: "{ not json" })),
		);

		expect(
			broken.includes("not valid JSON"),
			`a book that is not JSON is refused as such — ${broken}`,
		).toBe(true);
	}
});
test("the /checks init draft", async () => {
	{
		expect(
			parserFor("verify", "bunx vitest run") === "vitest" &&
				parserFor("verify", "jest") === "jest" &&
				parserFor("verify", "pytest -q") === "pytest" &&
				parserFor("verify", "tsc --noEmit") === "tsc" &&
				parserFor("verify", "biome check") === "biome" &&
				parserFor("verify", "eslint .") === "eslint",
			`a script that runs a known tool is read by that tool's parser — ${[
				parserFor("verify", "bunx vitest run"),
				parserFor("verify", "jest"),
				parserFor("verify", "pytest -q"),
			].join(",")}`,
		).toBe(true);
		expect(
			parserFor("typecheck", "node scripts/types.mjs") === "tsc" &&
				parserFor("lint", "node scripts/style.mjs") === "biome" &&
				parserFor("build", "node scripts/build.mjs") === "generic",
			`a name that sounds like a check is a fallback, not a guess — ${parserFor("build", "node scripts/build.mjs")}`,
		).toBe(true);
		expect(
			(await runnerFor(async (name) => name === "pnpm-lock.yaml")) === "pnpm" &&
				(await runnerFor(async (name) => name === "bun.lock")) === "bun" &&
				(await runnerFor(async () => false)) === "npm",
			"the lockfile decides how the project runs its scripts",
		).toBe(true);

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

		expect(
			Object.keys(draft?.checks ?? {}).join(",") === "typecheck,test,lint",
			`only the check-shaped scripts are drafted — ${Object.keys(draft?.checks ?? {}).join(",")}`,
		).toBe(true);
		expect(
			draft?.checks.typecheck?.run === "bun run typecheck",
			`a drafted recipe runs the project's own script — ${draft?.checks.typecheck?.run}`,
		).toBe(true);
		expect(
			draft?.checks.test?.parse === "vitest",
			`a drafted recipe names the parser it guessed — ${draft?.checks.test?.parse}`,
		).toBe(true);
		expect(
			draftRecipes({ scripts: { dev: "vite" } }, "npm") === undefined &&
				draftRecipes({}, "npm") === undefined &&
				draftRecipes(null, "npm") === undefined,
			"a manifest with nothing to check drafts nothing",
		).toBe(true);
	}
});

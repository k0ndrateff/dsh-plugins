/**
 * The `/checks init` draft: what a project's `package.json` already says about
 * its checks, turned into a recipe book to edit.
 *
 * The draft is printed, never written: a command that overwrote the file would
 * destroy a book someone tuned, and the file is short enough to paste.
 */

import type { ParserName } from "../shared/checks";

/** One drafted recipe. */
export interface DraftRecipe {
	readonly run: string;
	readonly parse: ParserName;
}

/** The config document the command prints. */
export interface Draft {
	readonly checks: Readonly<Record<string, DraftRecipe>>;
}

/** How a project's own scripts are run. */
export type ScriptRunner = "bun" | "npm" | "pnpm" | "yarn";

/** The lockfile that names each package manager, most specific first. */
const RUNNERS: readonly (readonly [string, ScriptRunner])[] = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
];

/** The words in a script's name that make it worth drafting as a check. */
export const CHECK_WORDS = [
	"lint",
	"type",
	"tsc",
	"test",
	"check",
	"build",
	"format",
	"biome",
	"eslint",
] as const;

/** Script names worth drafting: the ones that check something. */
const CHECK_LIKE = new RegExp(CHECK_WORDS.join("|"), "iu");

/** Which package manager's lockfile the project has, if any. */
export async function runnerFor(
	has: (name: string) => Promise<boolean>,
): Promise<ScriptRunner> {
	for (const [lockfile, runner] of RUNNERS)
		if (await has(lockfile)) return runner;

	return "npm";
}

/**
 * Guess how a script's output should be read.
 *
 * The command is the evidence and the name is the fallback: a script that runs
 * a known tool is read by that tool's parser, and one that only sounds like a
 * check keeps the exit-code parser rather than being guessed at.
 */
export function parserFor(name: string, command: string): ParserName {
	for (const [pattern, parser] of [
		[/\bvitest\b/u, "vitest"],
		[/\bjest\b/u, "jest"],
		[/\bpytest\b/u, "pytest"],
		[/\btsc\b/u, "tsc"],
		[/\bbiome\b/u, "biome"],
		[/\beslint\b/u, "eslint"],
	] as const)
		if (pattern.test(command)) return parser;

	if (/type-?check|types?$/iu.test(name)) return "tsc";
	if (/lint/iu.test(name)) return "biome";

	return "generic";
}

/**
 * The script names a draft would pass over, in manifest order.
 *
 * `/checks init` prints them when it drafts nothing: a project whose checks are
 * called `verify` or `ci` gets an empty draft, and without the list and the rule
 * behind it there is nothing to act on.
 * @param document - the parsed manifest.
 */
export function skippedScripts(document: unknown): readonly string[] {
	if (document === null || typeof document !== "object") return [];

	const scripts = (document as { scripts?: unknown }).scripts;

	if (scripts === null || typeof scripts !== "object") return [];

	return Object.entries(scripts)
		.filter(
			([name, command]) =>
				typeof command === "string" && command !== "" && !CHECK_LIKE.test(name),
		)
		.map(([name]) => name);
}

/**
 * Draft a recipe book from one `package.json`.
 * @param document - the parsed manifest.
 * @param runner - how this project runs its own scripts.
 * @returns the draft, or undefined when the manifest has no check-like script.
 */
export function draftRecipes(
	document: unknown,
	runner: ScriptRunner,
): Draft | undefined {
	if (document === null || typeof document !== "object") return undefined;

	const scripts = (document as { scripts?: unknown }).scripts;

	if (scripts === null || typeof scripts !== "object") return undefined;

	const checks: Record<string, DraftRecipe> = {};

	for (const [name, command] of Object.entries(scripts)) {
		if (typeof command !== "string" || command === "") continue;
		if (!CHECK_LIKE.test(name)) continue;

		checks[name] = {
			run: `${runner} run ${name}`,
			parse: parserFor(name, command),
		};
	}

	return Object.keys(checks).length === 0 ? undefined : { checks };
}

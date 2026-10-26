/**
 * The `/checks` command: what it reads, and what it says when it cannot.
 *
 *   bun run test/command.ts
 *
 * The command is the human's side of the recipe book, so its answers are the
 * ones a person reads: the directory and the deadlines, the refusal of a typo,
 * and — for `/checks init` — the rule that decided which scripts count. The
 * filesystem seam is faked with one in-memory project.
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type { CommandInvocation } from "@deepseek-ai/dsh-commands";
import { checkCommand } from "../src/host/command";
import { CONFIG_FILE } from "../src/host/config";
import { CHECK_WORDS } from "../src/host/draft";

const BOOK = JSON.stringify({
	checks: {
		typecheck: { run: "bun run typecheck", parse: "tsc" },
		test: { run: "bun run test", parse: "vitest", timeoutMs: 120_000 },
	},
});

/** A context whose filesystem serves one in-memory project. */
function contextWith(files: Record<string, string>): Context {
	return {
		fs: {
			resolve: async (path: string) => ({ path }),
			stat: async (target: { path: string }) =>
				files[target.path] === undefined ? undefined : {},
			readText: async (target: { path: string }) => files[target.path] ?? "",
		},
		workingDirectory: { ensure: async () => "/work/app" },
	} as unknown as Context;
}

/** One command call with the words a human typed. */
const run = (ctx: Context, rawInput: string) =>
	checkCommand.create({ ctx })({
		rawInput,
		agent: {},
		signal: new AbortController().signal,
	} as unknown as CommandInvocation);

test("a book the project has", async () => {
	{
		const answer = await run(contextWith({ [CONFIG_FILE]: BOOK }), "");

		expect(
			answer.kind === "success" &&
				(answer.text ?? "").includes("/work/app/dsh-checks.json"),
			`the answer names the directory and the file it read — ${answer.text ?? ""}`,
		).toBe(true);
		expect(
			(answer.text ?? "").includes("(tsc)") &&
				(answer.text ?? "").includes("timeout 2m"),
			`a recipe's parser is shown, and its own deadline when it has one — ${answer.text ?? ""}`,
		).toBe(true);
	}
});

test("no book, or one that is not JSON", async () => {
	{
		const none = await run(contextWith({}), "list");

		expect(
			none.kind === "error" && none.text.includes("/checks init"),
			`a project with no book is an error, with the advice — ${none.text ?? ""}`,
		).toBe(true);

		const broken = await run(contextWith({ [CONFIG_FILE]: "{ not json" }), "");

		expect(
			broken.kind === "error" && broken.text.includes("not valid JSON"),
			`a book that is not JSON is an error, not a list — ${broken.text ?? ""}`,
		).toBe(true);
	}
});

test("an action the command does not have", async () => {
	{
		const answer = await run(contextWith({ [CONFIG_FILE]: BOOK }), "ini");

		expect(
			answer.kind === "error" && (answer.text ?? "").includes("ini"),
			`a typo is refused rather than read as "list" — ${answer.text ?? ""}`,
		).toBe(true);
		expect(
			(answer.text ?? "").includes("/checks init") &&
				(answer.text ?? "").includes("/checks list"),
			`and the refusal lists the actions there are — ${answer.text ?? ""}`,
		).toBe(true);
	}
});

test("a manifest with nothing that looks like a check", async () => {
	{
		const answer = await run(
			contextWith({
				"package.json": JSON.stringify({
					scripts: { dev: "vite", start: "node ." },
				}),
			}),
			"init",
		);

		expect(
			answer.kind === "success" &&
				(answer.text ?? "").includes(CHECK_WORDS.join(", ")),
			`the empty draft explains the rule it applied — ${answer.text ?? ""}`,
		).toBe(true);
		expect(
			(answer.text ?? "").includes("dev") &&
				(answer.text ?? "").includes("start"),
			`and lists the scripts it passed over — ${answer.text ?? ""}`,
		).toBe(true);
	}
});

test("a manifest with checks in it", async () => {
	{
		const answer = await run(
			contextWith({
				"package.json": JSON.stringify({
					scripts: { typecheck: "tsc --noEmit", dev: "vite" },
				}),
			}),
			"init",
		);

		expect(
			answer.kind === "success" &&
				(answer.text ?? "").includes("bun run typecheck") === false,
			`the draft names how this project runs its scripts — ${answer.text ?? ""}`,
		).toBe(true);
		expect(
			(answer.text ?? "").includes("npm run typecheck"),
			`the lockfile decides the runner, and none is here — ${answer.text ?? ""}`,
		).toBe(true);
	}
});

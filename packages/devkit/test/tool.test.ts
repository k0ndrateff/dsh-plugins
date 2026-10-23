/**
 * The tool the model calls: its arguments, its text, and the payload the browser
 * half reads.
 *
 * The client half has no test of its own — it renders React in a page — so the
 * contract it depends on is pinned here: what `presentationMeta` hands over is
 * exactly what `asChecksCard` accepts, and a payload this version cannot read is
 * refused rather than drawn wrongly.
 *
 *   bun run test/tool.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { CONFIG_FILE } from "../src/host/config";
import { apply, inject, name } from "../src/host/index";
import { RecipeRunner } from "../src/host/runner";
import { checkTool } from "../src/host/tool";
import { asChecksCard, type ChecksCard } from "../src/shared/checks";

const BOOK = JSON.stringify({
	checks: {
		typecheck: { run: "bun run typecheck", parse: "tsc" },
		test: { run: "bun run test", parse: "vitest" },
	},
});

const TSC_OUTPUT = Array.from(
	{ length: 25 },
	(_, index) => `src/a.ts(${index + 1},3): error TS2322: problem ${index + 1}`,
).join("\n");

/** A context whose filesystem serves one project and whose shell answers from a script. */
function fakeContext(stdout: string, exitCode: number): Context {
	const files: Record<string, string> = { [CONFIG_FILE]: BOOK };

	return {
		fs: {
			resolve: async (path: string) => ({ path }),
			stat: async (target: { path: string }) =>
				files[target.path] === undefined ? undefined : {},
			readText: async (target: { path: string }) => files[target.path] ?? "",
		},
		workingDirectory: {
			ensure: async () => "/work/app",
		},
		shell: {
			resolve: (request: {
				command: string;
				workdir?: string;
				timeoutMs?: number;
			}) => ({
				command: request.command,
				workdir: request.workdir ?? "",
				timeoutMs: request.timeoutMs ?? 0,
				onExpiry: "kill",
				stdoutMaxBytes: 1_000_000,
				sandboxPolicy: undefined,
			}),
			execute: async (spec: { timeoutMs: number }) => ({
				result: async () => ({
					exitCode,
					signal: null,
					timedOut: false,
					aborted: false,
					timeoutMs: spec.timeoutMs,
					stdout: { text: stdout, truncated: false },
					stderr: { text: "", truncated: false },
				}),
			}),
		},
	} as unknown as Context;
}

/** One tool call's runtime context, as far as the tool reads it. */
function execution(): ToolRunContext {
	return {
		callId: "call-1",
		signal: new AbortController().signal,
		agent: {},
	} as unknown as ToolRunContext;
}

/** The text one render call produced. */
function textOf(definition: ToolDefinition, value: unknown): string {
	return definition.output
		.render({}, value as never)
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
}

test("one recipe", async () => {
	{
		const ctx = fakeContext(TSC_OUTPUT, 1);
		const definition = checkTool.create({ ctx, runner: new RecipeRunner(ctx) });
		const value = (await definition.execute(
			{ name: "typecheck" },
			execution(),
		)) as ChecksCard;

		expect(
			value.checks.length === 1 && value.callId === "call-1",
			`the run reports one check and its identity — ${`${value.checks.length}/${value.callId}`}`,
		).toBe(true);
		expect(
			value.ok === false && value.checks[0]?.status === "failed",
			`a failing check makes the run not ok — ${`${String(value.ok)}/${value.checks[0]?.status}`}`,
		).toBe(true);
		expect(
			value.checks[0]?.failures.length === 25,
			`the parser read every failure — ${String(value.checks[0]?.failures.length)}`,
		).toBe(true);

		const text = textOf(definition, value);

		expect(
			text.startsWith("0 of 1 checks passed."),
			`the text tells the model how many checks passed — ${text.split("\n")[0]}`,
		).toBe(true);
		expect(
			text.includes("typecheck") &&
				text.includes("25 errors") &&
				text.includes("src/a.ts:1:3 problem 1"),
			`the text names the check, its counts and a failure position — ${text.split("\n")[1]}`,
		).toBe(true);
		expect(
			text.includes("… 5 more") && !text.includes("problem 21"),
			`the text is bounded and says what it dropped — ${String(text.includes("problem 21"))}`,
		).toBe(true);

		const meta = definition.output.presentationMeta?.({}, value as never);

		expect(
			asChecksCard(meta)?.callId === "call-1" &&
				asChecksCard(meta)?.checks.length === 1,
			"the card payload is what the browser half validates",
		).toBe(true);
	}
});
test("every recipe, and none that exists", async () => {
	{
		const ctx = fakeContext("", 0);
		const definition = checkTool.create({ ctx, runner: new RecipeRunner(ctx) });

		const all = (await definition.execute({}, execution())) as ChecksCard;

		expect(
			all.checks.map((check) => check.name).join(",") === "typecheck,test",
			`omitting the name runs every recipe in config order — ${all.checks.map((check) => check.name).join(",")}`,
		).toBe(true);
		expect(all.ok === true, "a clean run is ok").toBe(true);

		let refusal = "";
		try {
			await definition.execute({ name: "nope" }, execution());
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error);
		}

		expect(
			refusal.includes("nope") && refusal.includes("typecheck"),
			`an unknown recipe is refused with the ones the project has — ${refusal}`,
		).toBe(true);
	}
});
test("what the browser half refuses", async () => {
	expect(
		asChecksCard(undefined) === undefined &&
			asChecksCard("checks") === undefined &&
			asChecksCard({ ok: true }) === undefined,
		"a payload that is not a card is refused",
	).toBe(true);
	expect(
		asChecksCard({ callId: "c", ok: true, checks: [] }) === undefined,
		"a card with no checks is refused",
	).toBe(true);
	expect(
		asChecksCard({
			callId: "c",
			ok: false,
			checks: [
				{
					name: "test",
					status: "failed",
					failures: [
						{ file: "a.ts", message: "" },
						{ file: "b.ts", message: "real" },
					],
				},
			],
		})?.checks[0]?.failures.length === 1,
		"a failure with no message is dropped, not drawn empty",
	).toBe(true);
	expect(
		asChecksCard({
			callId: "c",
			ok: false,
			checks: [{ name: "test", status: "exploded" }],
		})?.checks[0]?.status === "errored",
		"an unreadable status reads as errored rather than as passed",
	).toBe(true);
});
test("the plugin's composition root", async () => {
	const registered: { tools: string[]; commands: string[] } = {
		tools: [],
		commands: [],
	};
	const registering = {
		...fakeContext("", 0),
		tools: {
			register: (definition: { name: string }) => {
				registered.tools.push(definition.name);

				return () => {};
			},
		},
		commands: {
			register: (definition: { name: string }) => {
				registered.commands.push(definition.name);

				return () => {};
			},
		},
	} as unknown as Context;

	apply(registering);

	expect(
		name === "dsh-devkit" &&
			["tools", "commands", "shell", "fs", "workingDirectory"].every(
				(service) => inject.includes(service),
			),
		`the plugin names itself and declares the services it needs — ${`${name}: ${inject.join(", ")}`}`,
	).toBe(true);
	expect(
		registered.tools.join(",") === "checks",
		`it registers the checks tool — ${registered.tools.join(",")}`,
	).toBe(true);
	expect(
		registered.commands.join(",") === "checks",
		`it registers the /checks command — ${registered.commands.join(",")}`,
	).toBe(true);
});

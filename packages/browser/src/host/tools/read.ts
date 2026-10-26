/**
 * `browser_read` — what the page says and what it logged.
 *
 * Three questions a developer asks of a page after changing it: is the content
 * still there, did anything appear in the console, and did the page throw. They
 * are one tool because they are read the same way, at the same moment, and each
 * answer is a short list of lines rather than a document.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { BROWSER_READ_TOOL } from "../../shared/tools";
import { fieldOf, isList, isText, modelData } from "../envelope";
import { bound } from "../text";
import { type BrowserToolDeps, runForSession } from "./deps";
import { failureOf } from "./failure";

/** The three logs this tool reads. */
const KINDS = ["text", "console", "errors"] as const;

type Kind = (typeof KINDS)[number];

/**
 * What the answer says when the log is empty.
 *
 * "The page has not thrown" is the one sentence this tool must not say on its
 * own: a page that catches its own failures logs them to the console instead, so
 * `errors` being quiet is not the same as everything working. The empty answers
 * point at the other log and say the two are read together.
 */
const EMPTY: Record<Kind, string> = {
	text: "The page has no readable text.",
	console:
		"The console is empty. The page may still have thrown: read `errors` as well.",
	errors:
		"No uncaught errors were recorded. Errors the page catches and logs itself appear in `console` instead — read that too after a change.",
};

/** The arguments the model may send, after validation. */
interface ReadArgs {
	readonly what: Kind;
	readonly clear: boolean;
}

/** One entry of a logged list, as lines. */
const entryLines = (
	entries: readonly unknown[],
	render: (record: Record<string, unknown>) => string[],
): string[] =>
	entries.flatMap((entry) =>
		entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? render(entry as Record<string, unknown>)
			: [],
	);

/** Where one error happened, as `url:line:column` with the parts it has. */
const locationOf = (record: Record<string, unknown>): string => {
	const url =
		typeof record.url === "string" && record.url !== "" ? record.url : "";
	const line = typeof record.line === "number" ? record.line : undefined;
	const column = typeof record.column === "number" ? record.column : undefined;

	if (line === undefined && column === undefined) return url === "" ? "" : url;
	if (url === "") return `line ${String(line ?? "?")}:${String(column ?? "?")}`;

	return `${url}:${String(line ?? "?")}:${String(column ?? "?")}`;
};

/**
 * A document's lines, without the blank ones at either end.
 *
 * Blank lines *inside* the text are paragraph breaks and are kept: a page read
 * as one run-on block is a page the model misreads. Only the padding around the
 * document goes.
 */
const trimmedLines = (text: string): string[] => {
	const lines = text.split("\n");
	const first = lines.findIndex((line) => line.trim() !== "");

	if (first === -1) return [];

	let last = lines.length - 1;

	while (last > first && (lines[last] ?? "").trim() === "") last -= 1;

	return lines.slice(first, last + 1);
};

class ReadTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_READ_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the caps.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Read what the page says and what it logged: its text, the browser console, or the " +
			"uncaught errors the page threw. Use it after a change to see whether the UI still " +
			"renders and whether the console reports anything the change introduced. `errors` " +
			"only sees uncaught failures: many frameworks catch an error and log it, so read " +
			"`console` too — a quiet `errors` does not mean a clean page.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				what: {
					type: "string",
					enum: [...KINDS],
					description:
						"What to read: `text` (the page as a person reads it, the default), `console` " +
						"(what the page logged), or `errors` (what the page threw).",
				},
				clear: {
					type: "boolean",
					description:
						"Empty the console or error log after reading it. Only meaningful for " +
						"`console` and `errors`; the default keeps what it read.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					what: { type: "string" },
					text: { type: "string" },
					count: { type: "number" },
				},
				required: ["what", "text", "count"],
			},
			render: (_args, value) => {
				const read = value as { what: Kind; text: string; count: number };

				return [
					{
						type: "text",
						text: read.count === 0 ? EMPTY[read.what] : read.text,
					},
				];
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const { outcome } = await runForSession(deps, exec, this.argv(args));

			if (!outcome.ok) throw failureOf(outcome);

			const lines = this.lines(args.what, modelData(outcome.data));
			const whole = lines.join("\n");
			const text = bound(whole, deps.config.maxOutputBytes);

			return {
				what: args.what,
				text,
				// The count names the lines the model can actually read, not the
				// ones the cut dropped.
				count:
					text === whole
						? lines.length
						: Math.max(0, text.split("\n").length - 1),
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): ReadArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const what = args.what;

		if (what !== undefined && !KINDS.includes(what as Kind))
			throw new Error(`browser_read reads one of: ${KINDS.join(", ")}`);

		return {
			what: (what ?? "text") as Kind,
			clear: args.clear === true,
		};
	}

	/** The CLI arguments one log is read with. */
	private argv(args: ReadArgs): string[] {
		if (args.what === "text") return ["read"];

		return [args.what, ...(args.clear ? ["--clear"] : [])];
	}

	/** One log as lines the model reads. */
	private lines(what: Kind, data: unknown): string[] {
		if (what === "text")
			return trimmedLines(fieldOf(data, "content", isText) ?? "");

		if (what === "console")
			return entryLines(fieldOf(data, "messages", isList) ?? [], (record) => {
				const text = typeof record.text === "string" ? record.text : "";

				return text === ""
					? []
					: [
							`${typeof record.type === "string" ? record.type : "log"}: ${text}`,
						];
			});

		return entryLines(fieldOf(data, "errors", isList) ?? [], (record) => {
			const text = typeof record.text === "string" ? record.text : "";

			if (text === "") return [];

			const lines = text.split("\n").filter((line) => line.trim() !== "");
			const where = locationOf(record);

			// Where the error happened is the half of the answer the model acts on;
			// the CLI reports it beside the text and this tool used to drop it.
			return where === "" ? lines : [...lines, `  at ${where}`];
		});
	}
}

export const readTool = new ReadTool();

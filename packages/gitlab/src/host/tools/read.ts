/**
 * `gitlab_read` — GET for the long tail the other tools do not cover.
 *
 * Projects, issues, commits, branches, repository files, users, labels,
 * milestones, releases and search all live under the same authenticated API, and
 * the model sometimes needs one of them for its own reasoning. This tool is the
 * read-only way in: the token stays in the harness, so there is no reason to
 * reach for a shell command or a token on disk.
 *
 * Not every endpoint answers JSON: a repository file's raw contents and a job's
 * trace are text, and an artifact is bytes. The tool therefore reads the content
 * type first and reports what it actually got, and it repeats GitLab's paging
 * headers — a list answers one page, so the model can tell a full answer from a
 * first page instead of taking the page for the whole list.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { isRecord, nonEmptyString } from "dsh-integration-host/shape";
import { GITLAB_READ_TOOL } from "../../shared/tools";
import type { GitLabApi, Param, RawAnswer } from "../api";
import { bounded } from "./text";

/** How much of a JSON answer the model reads. */
const MAX_JSON_CHARS = 32_000;

/** How much of a plain-text answer the model reads. */
const MAX_TEXT_CHARS = 32_000;

/** A path under the instance's `/api/v4`, with a single leading slash. */
const API_PATH = /^\/(?!\/)/u;

/** What the tool needs from the plugin. */
export interface ReadDeps {
	readonly api: GitLabApi;
}

/** The arguments the model may send, after validation. */
interface ReadArgs {
	readonly path: string;
	readonly query: Readonly<Record<string, Param>>;
}

class ReadTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = GITLAB_READ_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the channel to GitLab.
	 */
	create = (deps: ReadDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Read any GitLab REST API endpoint with GET — the long tail the other gitlab_* tools do " +
			"not cover: projects, issues, commits, branches, repository files, users, labels, " +
			"milestones, releases and search. Pass an API path under the instance's /api/v4, such as " +
			"`/projects/group%2Fproject/issues` or `/search?scope=blobs&search=retry`, and optional " +
			"query parameters. JSON and plain-text endpoints both work (a repository file's raw " +
			"contents, a job's trace); binary endpoints such as artifacts are reported as such rather " +
			"than decoded. A list endpoint answers one page of 20 rows by default: the answer names " +
			"the page, the total and any next page, so pass `page` and a larger `per_page` to walk a " +
			"long list instead of treating the first page as the whole answer. Merge requests, review " +
			"threads, pipelines and job logs have their own tools; use them first. This tool is " +
			"read-only and uses the personal access token stored in the harness: never run `glab` and " +
			"never look for a token on disk.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["path"],
			properties: {
				path: {
					type: "string",
					description:
						'The API path under /api/v4, beginning with "/", for example "/projects" or ' +
						'"/search?scope=blobs&search=retry". A query string may go in the path or in `query`.',
				},
				query: {
					type: "object",
					additionalProperties: true,
					description:
						"Optional query parameters, merged over any in the path. Values may be strings, " +
						"numbers or booleans; anything else is ignored. For a list, `page` and `per_page` " +
						"walk it: GitLab sends 20 rows a page unless told otherwise.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					summary: { type: "string" },
					path: { type: "string" },
					contentType: { type: "string" },
					total: { type: "integer" },
					page: { type: "integer" },
					nextPage: { type: "integer" },
					truncated: { type: "boolean" },
				},
				required: ["summary", "path", "truncated"],
			},
			render: (_args, value) => [
				{ type: "text", text: (value as { summary: string }).summary },
			],
		},
		execute: async (rawArgs) => {
			const args = this.parseArgs(rawArgs);
			const marker = args.path.indexOf("?");
			const path = marker === -1 ? args.path : args.path.slice(0, marker);
			const search = marker === -1 ? "" : args.path.slice(marker + 1);
			const params = this.paramsOf(search, args.query);
			const answer = await deps.api.read(path, params);
			const page = answer.page ?? this.numberParam(params.page) ?? 1;
			const shown = Array.isArray(answer.value)
				? answer.value.length
				: undefined;
			const body = this.bodyOf(answer);
			const header = [
				`GET ${this.requestOf(path, params)}`,
				answer.contentType === "" ? undefined : answer.contentType,
				shown === undefined
					? undefined
					: `${shown} row${shown === 1 ? "" : "s"} on page ${page}`,
				answer.total === undefined ? undefined : `${answer.total} total`,
			]
				.filter((part): part is string => part !== undefined)
				.join(" — ");

			const lines = [header, this.nextOf(answer), body.text].filter(
				(line): line is string => line !== undefined && line !== "",
			);

			return {
				summary: lines.join("\n"),
				path,
				contentType: answer.contentType,
				...(answer.total === undefined ? {} : { total: answer.total }),
				...(shown === undefined ? {} : { page }),
				...(answer.nextPage === undefined ? {} : { nextPage: answer.nextPage }),
				truncated: body.truncated,
			};
		},
	});

	/** The body as the model reads it, or what stands in for bytes. */
	private bodyOf(answer: RawAnswer): {
		readonly text: string;
		readonly truncated: boolean;
	} {
		if (answer.isBinary)
			return {
				text: `GitLab answered a ${answer.contentType} body; this tool shows JSON and text, not bytes. Open the endpoint in GitLab if you need the file itself.`,
				truncated: false,
			};

		if (!answer.isJson) return bounded(answer.text, MAX_TEXT_CHARS);

		const cut = bounded(
			JSON.stringify(answer.value, null, 2) ?? answer.text,
			MAX_JSON_CHARS,
		);

		return {
			text: cut.truncated
				? `${cut.text}\n… (the answer was cut at ${MAX_JSON_CHARS} characters; ask for a narrower endpoint)`
				: cut.text,
			truncated: cut.truncated,
		};
	}

	/** What GitLab said about the rest of a list. */
	private nextOf(answer: RawAnswer): string | undefined {
		if (answer.nextPage === undefined) return undefined;

		return `…more rows on page ${answer.nextPage}; pass the same path with page: ${answer.nextPage}${
			answer.nextPage === 2 ? " and per_page: 100 to widen each page" : ""
		}.`;
	}

	/** One query value as a number, when it is a positive integer. */
	private numberParam(value: Param): number | undefined {
		const number = Number(value);

		return Number.isInteger(number) && number > 0 ? number : undefined;
	}

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): ReadArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const path = nonEmptyString(args.path) ?? "";

		if (!API_PATH.test(path))
			throw new Error(
				`"${path}" is not a GitLab API path; pass a path that begins with "/", such as "/projects"`,
			);

		return { path, query: this.queryOf(args.query) };
	}

	/** The `query` object, keeping only values GitLab takes as a parameter. */
	private queryOf(value: unknown): Record<string, Param> {
		const query: Record<string, Param> = {};
		if (!isRecord(value)) return query;

		for (const [name, candidate] of Object.entries(value)) {
			if (
				typeof candidate === "string" ||
				typeof candidate === "number" ||
				typeof candidate === "boolean"
			)
				query[name] = candidate;
		}

		return query;
	}

	/** The path's own query string, overlaid with the `query` object. */
	private paramsOf(
		search: string,
		query: Readonly<Record<string, Param>>,
	): Record<string, Param> {
		const params: Record<string, Param> = {};

		for (const [name, value] of new URLSearchParams(search))
			params[name] = value;

		return { ...params, ...query };
	}

	/** The request as one line, so the model can see what was actually read. */
	private requestOf(
		path: string,
		params: Readonly<Record<string, Param>>,
	): string {
		const search = new URLSearchParams();

		for (const [name, value] of Object.entries(params))
			search.set(name, String(value));

		const query = search.toString();

		return query === "" ? path : `${path}?${query}`;
	}
}

export const readTool = new ReadTool();

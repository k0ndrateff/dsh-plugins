/**
 * `gitlab_read` — GET for the long tail the other tools do not cover.
 *
 * Projects, issues, commits, branches, repository files, users, labels,
 * milestones, releases and search all live under the same authenticated API, and
 * the model sometimes needs one of them for its own reasoning. This tool is the
 * read-only way in: the token stays in the harness, so there is no reason to
 * reach for a shell command or a token on disk.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { isRecord, nonEmptyString } from "dsh-integration-host/shape";
import { GITLAB_READ_TOOL } from "../../shared/tools";
import type { GitLabApi, Param } from "../api";
import { bounded } from "./text";

/** How much of a JSON answer the model reads. */
const MAX_JSON_CHARS = 32_000;

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
			"query parameters. Merge requests, review threads, pipelines and job logs have their own " +
			"tools; use them first. This tool is read-only and uses the personal access token stored " +
			"in the harness: never run `glab` and never look for a token on disk.",
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
						"numbers or booleans; anything else is ignored.",
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
					total: { type: "integer" },
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
			const answer = await deps.api.getAnswer(path, params);
			const cut = bounded(
				JSON.stringify(answer.value, null, 2) ?? "",
				MAX_JSON_CHARS,
			);
			const body = cut.truncated
				? `${cut.text}\n… (the answer was cut at ${MAX_JSON_CHARS} characters; ask for a narrower endpoint)`
				: cut.text;
			const header = `GET ${this.requestOf(path, params)}${answer.total === undefined ? "" : ` — total ${answer.total}`}`;

			return {
				summary: body === "" ? header : `${header}\n${body}`,
				path,
				...(answer.total === undefined ? {} : { total: answer.total }),
				truncated: cut.truncated,
			};
		},
	});

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

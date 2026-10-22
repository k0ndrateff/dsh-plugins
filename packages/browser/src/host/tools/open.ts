/**
 * `browser_open` — put a page in front of the agent.
 *
 * The browser keeps its cookies, storage and tabs between calls, so opening is
 * how a session reaches the page it is working on, and every later call acts on
 * whatever is open. The answer carries the page's own title and its final
 * address, because a redirect is the first thing worth knowing about.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { PanelOpenMeta } from "../../shared/panel";
import { BROWSER_OPEN_TOOL } from "../../shared/tools";
import { fieldOf, isText, modelData } from "../envelope";
import { type BrowserToolDeps, runForSession } from "./deps";

/** The arguments the model may send, after validation. */
interface OpenArgs {
	readonly url: string;
}

class OpenTool {
	/** The wire name the agent calls. */
	readonly TOOL_NAME = BROWSER_OPEN_TOOL;

	/**
	 * Build the tool definition for one plugin instance.
	 * @param deps - the runner, the session scope, and the caps.
	 */
	create = (deps: BrowserToolDeps): ToolDefinition => ({
		name: this.TOOL_NAME,
		description:
			"Open a URL in this conversation's own browser and answer with the page's title and " +
			"address. The browser is a real Chrome that keeps its cookies and tabs between calls, " +
			"so this is how to reach the page you are working on; call browser_snapshot next to " +
			"see what is on it. Prefer this over running agent-browser through `bash`: the " +
			"browser stays pinned to this conversation.",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["url"],
			properties: {
				url: {
					type: "string",
					description:
						"The page to open, as an absolute URL — usually the dev server you are " +
						"working on, such as http://localhost:3000/checkout.",
				},
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					session: { type: "string" },
					url: { type: "string" },
					title: { type: "string" },
				},
				required: ["session", "url", "title"],
			},
			render: (_args, value) => {
				const page = value as { url: string; title: string };

				return [
					{
						type: "text",
						text:
							page.title === ""
								? `Opened the page.\n${page.url}`
								: `Opened “${page.title}”.\n${page.url}`,
					},
				];
			},
			// The browser half reads this back as `result.meta`: the page opens the
			// panel on the browser this call just proved exists.
			presentationMeta: (_args, value) => {
				const page = value as unknown as PanelOpenMeta;

				return { session: page.session, url: page.url, title: page.title };
			},
		},
		execute: async (rawArgs, exec) => {
			const args = this.parseArgs(rawArgs);
			const { session, outcome } = await runForSession(deps, exec, [
				"open",
				args.url,
			]);

			if (!outcome.ok) throw new Error(outcome.error);

			const data = modelData(outcome.data);

			return {
				session: session.name,
				url: fieldOf(data, "url", isText) ?? args.url,
				title: fieldOf(data, "title", isText) ?? "",
			};
		},
	});

	/** Validate the model's arguments; unknown keys are ignored. */
	private parseArgs(rawArgs: unknown): OpenArgs {
		const args =
			rawArgs !== null && typeof rawArgs === "object"
				? (rawArgs as Record<string, unknown>)
				: {};
		const url = args.url;

		if (typeof url !== "string" || url.trim() === "")
			throw new Error("browser_open needs a url");

		return { url: url.trim() };
	}
}

export const openTool = new OpenTool();

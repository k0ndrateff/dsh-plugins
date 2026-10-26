/**
 * `digest` — the tool that assembles the card.
 *
 * It resolves nothing by itself: the collector asks whichever integrations are
 * installed for the blocks the user kept, and this turns the answer into one
 * durable presentation for the turn. The model reads the text result; the
 * record is what the browser half renders under the closing prose.
 *
 * The tool takes no arguments on purpose. A digest is a configured artifact —
 * what it contains and when it arrives are settings — and a model that could
 * narrow it per call would produce a different digest every morning, which is
 * the one thing a digest must not do.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { JsonValue } from "dsh-mcp-oauth";
import type { DigestCollector } from "./collect";

/** What the tool needs from the plugin. */
export interface DigestToolDeps {
	readonly collector: DigestCollector;
}

/** Build the tool definition for one plugin instance. */
export const digestTool = (deps: DigestToolDeps): ToolDefinition => ({
	name: "digest",
	description:
		"Assemble the user's configured digest: the work waiting for them across the integrations " +
		"they have connected — Jira issues in flight, merge requests awaiting their review, new " +
		"errors, review comments. The digest is configured in Settings, and its schedule may be " +
		'daily or only on selected days, so call it "the digest", not "the daily digest". Use it ' +
		'when the user asks for a digest, a summary, or "what\'s on my plate", and when a ' +
		"scheduled digest reminder fires. Each block shows up to the configured number of rows " +
		"and says how many more it had. It reads only: it never writes to an external system. " +
		"What it contains is the user's own saved configuration, so call it with no arguments.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {},
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				summary: { type: "string" },
				report: { type: "object", additionalProperties: true },
			},
			required: ["summary", "report"],
		},
		render: (_args, value) => [
			{ type: "text", text: (value as { summary: string }).summary },
		],
		// The browser half reads this back as `result.meta` and renders the card.
		// It never reaches the model: the text above is what the model reads.
		presentationMeta: (_args, value) => (value as { report: JsonValue }).report,
	},
	execute: async (_args, exec) => {
		const collected = await deps.collector.collect(
			String(exec.callId),
			new Date(),
		);

		return { summary: collected.summary, report: collected.report };
	},
});

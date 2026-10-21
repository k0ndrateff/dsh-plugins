/**
 * `correlate` — the tool that follows a chain across providers.
 *
 * The user names an integration and one of its objects; the tool asks every
 * installed integration that can answer about the links from there. It is a
 * read from end to end: nothing here writes to an external system, so no
 * confirmation stands in front of it.
 *
 * The text result is what the model reads, and it is written as the chain
 * itself — one hop per line, in the order the chain reaches them — because that
 * is the answer to the question that was asked. The record is what the browser
 * half draws under the closing prose.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { JsonValue } from "dsh-mcp-oauth";
import type { ChainReport } from "../shared/meta";
import { buildChain, type ChainResolver } from "./chain";

/** What the tool needs from the plugin. */
export interface CorrelateToolDeps {
	readonly sources: ChainResolver;
}

/** The wire name the card is claimed under. */
export const CORRELATE_TOOL = "correlate";

/** One hop, as the model reads it. */
const hopLine = (hop: ChainReport["hops"][number], index: number): string =>
	`${index + 1}. ${hop.label} · ${hop.provider} · ${hop.title}${
		hop.meta === undefined ? "" : ` — ${hop.meta}`
	}${hop.url === undefined ? "" : `\n   ${hop.url}`}`;

/** A break, as the model reads it. */
const breakLine = (item: ChainReport["breaks"][number]): string =>
	`- ${item.label} not followed: ${item.reason}`;

/**
 * The chain as one text result.
 *
 * A chain that reached nothing is still an answer, and says so in as many words:
 * "nothing was found" and "no integration resolves this" are different facts,
 * and the model repeats whichever it got.
 */
export const chainSummary = (report: ChainReport): string => {
	const lines = [`Chain from ${report.provider}: ${report.title}`];

	if (report.hops.length > 0)
		lines.push("", ...report.hops.map((hop, index) => hopLine(hop, index)));

	if (report.breaks.length > 0)
		lines.push("", "Not followed:", ...report.breaks.map(breakLine));

	if (report.hops.length === 0 && report.breaks.length === 0)
		lines.push("", "Nothing was found for that reference.");

	return lines.join("\n");
};

/** Build the tool definition for one plugin instance. */
export const correlateTool = (deps: CorrelateToolDeps): ToolDefinition => ({
	name: CORRELATE_TOOL,
	description:
		"Follow one object across the integrations the user has connected: a Sentry error to " +
		"the commit behind it, that commit to the merge request it belongs to, and the ticket " +
		"either names — plus whatever else the installed integrations know about each hop. Use " +
		"it when the user asks where an error came from, what shipped the change, or which " +
		"ticket a failure belongs to. It reads only. Name the integration to start from " +
		"(such as Sentry, GitLab or Atlassian) and one of its own identifiers.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			provider: {
				type: "string",
				description:
					"The integration to start from, as it names itself, such as Sentry.",
			},
			ref: {
				type: "string",
				description:
					"Its own identifier: a Sentry issue short id or link, a commit sha, a merge " +
					"request as group/project!12, or a tracker key such as DEV-5977.",
			},
		},
		required: ["provider", "ref"],
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
	execute: async (rawArgs, exec) => {
		const args = rawArgs as { readonly provider: string; readonly ref: string };
		const report = await buildChain(deps.sources, {
			callId: String(exec.callId),
			provider: args.provider,
			ref: args.ref,
		});

		return {
			summary: chainSummary(report),
			report: report as unknown as JsonValue,
		};
	},
});

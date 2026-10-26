/**
 * `correlate` — the tool that follows a chain across providers.
 *
 * The user names an integration and one of its objects; the tool asks every
 * installed integration that can answer about the links from there. It is a
 * read from end to end: nothing here writes to an external system, so no
 * confirmation stands in front of it.
 *
 * The text result is what the model reads, and it is written as the chain
 * itself — one hop per line, indented by its level, with the hop that pointed
 * at it — because that is the answer to the question that was asked. A hop the
 * chain could not follow sits under the hop that named it, with the class of
 * the failure and the provider's own words; the walk's caps are named too, so a
 * truncated chain cannot be retold as a whole one. The record is what the
 * browser half draws under the closing prose.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { JsonValue } from "dsh-mcp-oauth";
import {
	BREAK_CAUSE_LABELS,
	type ChainBreak,
	type ChainHop,
	type ChainReport,
} from "../shared/meta";
import { buildChain, type ChainResolver, DEFAULT_CHAIN_LIMITS } from "./chain";

/** What the tool needs from the plugin. */
export interface CorrelateToolDeps {
	readonly sources: ChainResolver;
}

/** The wire name the card is claimed under. */
export const CORRELATE_TOOL = "correlate";

/** One level of the chain, indented by two spaces in the text. */
const indent = (depth: number): string => "  ".repeat(Math.max(0, depth));

/** How many hops a chain holds, and how many it could not follow. */
const countsOf = (report: ChainReport): string => {
	const hops = `${report.hops.length} hop${report.hops.length === 1 ? "" : "s"}`;
	const breaks = `${report.breaks.length} not followed`;

	return report.breaks.length === 0 ? hops : `${hops}, ${breaks}`;
};

/** One hop, as the model reads it. */
const hopLine = (hop: ChainHop, step: number): string =>
	`${indent(hop.depth)}${step}. ${hop.label} · ${hop.provider} · ${hop.title}${
		hop.meta === undefined ? "" : ` — ${hop.meta}`
	}${hop.url === undefined ? "" : `\n${indent(hop.depth)}   ${hop.url}`}`;

/** A break, as the model reads it — under the hop that pointed at it. */
const breakLine = (item: ChainBreak): string => {
	const cause =
		item.cause === undefined ? "" : ` (${BREAK_CAUSE_LABELS[item.cause]})`;

	return `${indent(item.depth)}- ${item.label} not followed${cause}: ${item.reason}`;
};

/** The first break at the walk's own cap, when the chain was cut. */
const capped = (report: ChainReport): string | undefined => {
	const limit = report.breaks.find((item) => item.cause === "limit");

	if (limit === undefined) return undefined;

	const bounds = report.limits;
	const caps =
		bounds === undefined
			? "the walk's caps"
			: `${bounds.depth} levels and ${bounds.facts} hops`;

	return `The chain is capped at ${caps}; narrow the question and run it again from the nearest object.`;
};

/** What more than one installed integration could have answered. */
const coverageLine = (report: ChainReport): string | undefined => {
	const shared = report.coverage ?? [];

	if (shared.length === 0) return undefined;

	return shared
		.map((item) => {
			const others = item.providers.filter(
				(provider) => provider !== item.answeredBy,
			);

			return item.answeredBy === undefined
				? `${item.kind} references can be resolved by ${item.providers.join(", ")}.`
				: `${item.kind} references can be resolved by ${item.providers.join(", ")}; ${item.answeredBy} answered, ${others.join(", ")} was not asked.`;
		})
		.join(" ");
};

/**
 * The chain as one text result.
 *
 * A chain that reached nothing is still an answer, and says so in as many words:
 * "nothing was found" and "no integration resolves this" are different facts,
 * and the model repeats whichever it got.
 */
export const chainSummary = (report: ChainReport): string => {
	const lines = [`Chain from ${report.provider}: ${report.title}`];
	const used = new Set<number>();
	/** A break hangs under the hop that named it; the anchor's own come first. */
	const take = (parent: string | undefined): readonly ChainBreak[] =>
		report.breaks.filter((item, index) => {
			if (used.has(index) || item.parent !== parent) return false;

			used.add(index);

			return true;
		});

	if (report.hops.length > 0 || report.breaks.length > 0) lines.push("");

	for (const item of take(undefined)) lines.push(breakLine(item));

	for (const [index, hop] of report.hops.entries()) {
		lines.push(hopLine(hop, index + 1));

		for (const item of take(hop.id)) lines.push(breakLine(item));
	}

	// A break whose parent hop is not in the chain still belongs in the answer.
	for (const [index, item] of report.breaks.entries())
		if (!used.has(index)) lines.push(breakLine(item));

	if (report.hops.length === 0 && report.breaks.length === 0)
		lines.push("", "Nothing was found for that reference.");

	if (report.hops.length > 0 || report.breaks.length > 0)
		lines.push("", countsOf(report));

	const cap = capped(report);
	if (cap !== undefined) lines.push(cap);

	const coverage = coverageLine(report);
	if (coverage !== undefined) lines.push(coverage);

	return lines.join("\n");
};

/** Build the tool definition for one plugin instance. */
export const correlateTool = (deps: CorrelateToolDeps): ToolDefinition => ({
	name: CORRELATE_TOOL,
	description:
		"Follow one object across the integrations the user has connected: a Sentry error to " +
		"the commit behind it, that commit to the merge request it belongs to, and the ticket " +
		"that names it — plus whatever else the installed integrations know about each hop. Use " +
		"it when the user asks where an error came from, what shipped the change, or which " +
		"ticket a failure belongs to. It reads only. Name the integration to start from " +
		"(such as Sentry, GitLab or Atlassian) and one of its own identifiers; a chain starts " +
		"from the provider's own anchor, such as an error, a merge request or a ticket, and " +
		`may also start from a commit sha when that provider resolves commits. The walk is ` +
		`capped at ${DEFAULT_CHAIN_LIMITS.depth} levels and ${DEFAULT_CHAIN_LIMITS.facts} hops ` +
		"and says so in the result when it stops at one.",
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
					"Its own identifier, in a spelling that integration starts from: a Sentry " +
					"issue short id or link (Sentry), a merge request as group/project!12 or a " +
					"commit sha (GitLab), a tracker key such as DEV-5977 (Atlassian).",
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

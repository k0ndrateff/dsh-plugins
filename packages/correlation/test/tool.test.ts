/**
 * The `correlate` tool and the card payload it records.
 *
 * The tool is a thin shell over the walk, so what is worth checking here is the
 * contract with both readers: the text the model gets, the record the browser
 * half narrows, and what happens when the payload is not one this version knows.
 * No live endpoint is touched, so the file runs anywhere.
 *
 *   bun run test/tool.ts
 */

import { expect, test } from "bun:test";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type {
	CorrelationFact,
	CorrelationKind,
	CorrelationRef,
} from "dsh-integration-host/correlation";
import type { ChainResolver } from "../src/host/chain";
import { chainSummary, correlateTool } from "../src/host/tool";
import { asChainReport } from "../src/shared/meta";

/** The chain the fake integrations answer with. */
const ANSWERS: Readonly<Record<string, readonly CorrelationFact[]>> = {
	"error:CHECKOUT-13P": [
		{
			id: "sentry:CHECKOUT-13P",
			provider: "Sentry",
			kind: "error",
			label: "Error",
			title: "CHECKOUT-13P · AxiosError: Request failed with status code 422",
			url: "https://acme.sentry.io/issues/CHECKOUT-13P",
			meta: "unresolved · 35 events",
			references: [
				{ kind: "commit", sha: "7c50a1e5", label: "Suspect commit" },
			],
		},
	],
	"commit:7c50a1e5@": [
		{
			id: "gitlab:acme/storefront@7c50a1e5",
			provider: "GitLab",
			kind: "commit",
			label: "Commit",
			title: "7c50a1e5 · DEV-5977: Handle split 500 error codes",
			meta: "Grace Hopper",
			references: [
				{ kind: "change", repository: "acme/storefront", number: "42" },
			],
		},
	],
	"change:acme/storefront!42": [
		{
			id: "gitlab:acme/storefront!42",
			provider: "GitLab",
			kind: "change",
			label: "Merge request",
			title: "acme/storefront!42 · Handle split codes",
			meta: "opened · Ada Lovelace",
			references: [{ kind: "task", key: "DEV-5977" }],
		},
	],
	"task:DEV-5977": [
		{
			id: "jira:DEV-5977",
			provider: "Atlassian",
			kind: "task",
			label: "Jira issue",
			title: "DEV-5977 · Handle split 500 error codes",
			url: "https://acme.atlassian.net/browse/DEV-5977",
			meta: "In review · Ada Lovelace",
		},
	],
};

/** A registry of fakes over {@link ANSWERS}. */
function fakeSources(
	providers: readonly {
		provider: string;
		entry: CorrelationKind;
		resolves: readonly CorrelationKind[];
	}[],
): ChainResolver {
	return {
		providers,
		entryOf: (provider) =>
			providers.find((item) => item.provider === provider)?.entry,
		canResolve: (kind) =>
			providers.some((item) => item.resolves.includes(kind)),
		resolve: async (ref: CorrelationRef) => ANSWERS[refKey(ref)] ?? [],
	};
}

/** The key a fake answers by, spelled as the walk deduplicates. */
function refKey(ref: CorrelationRef): string {
	switch (ref.kind) {
		case "error":
			return `error:${ref.id}`;
		case "commit":
			return `commit:${ref.sha}@${ref.url ?? ref.repository ?? ""}`;
		case "change":
			return `change:${ref.repository}!${ref.number}`;
		case "task":
			return `task:${ref.key}`;
	}
}

/** One tool execution, as far as the tool reads it. */
function execution(callId = "call-1"): ToolRunContext {
	return {
		callId,
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

const SOURCES = fakeSources([
	{ provider: "Sentry", entry: "error", resolves: ["error"] },
	{ provider: "GitLab", entry: "change", resolves: ["commit", "change"] },
	{ provider: "Atlassian", entry: "task", resolves: ["task"] },
]);

test("the tool", async () => {
	const definition = correlateTool({ sources: SOURCES });

	expect(
		JSON.stringify(Object.keys(definition.parameters.properties ?? {})) ===
			'["provider","ref"]' &&
			JSON.stringify(definition.parameters.required) === '["provider","ref"]',
		`and asks for the integration and the object, nothing else — ${JSON.stringify(definition.parameters)}`,
	).toBe(true);

	const value = (await definition.execute(
		{ provider: "Sentry", ref: "CHECKOUT-13P" },
		execution(),
	)) as { summary: string; report: Record<string, unknown> };

	expect(
		value.summary.includes("1. Error · Sentry · CHECKOUT-13P") &&
			value.summary.includes("2. Commit · GitLab · 7c50a1e5") &&
			value.summary.includes(
				"3. Merge request · GitLab · acme/storefront!42",
			) &&
			value.summary.includes("4. Jira issue · Atlassian · DEV-5977") &&
			!value.summary.includes("Not followed"),
		`the model reads the chain, hop by hop — ${value.summary}`,
	).toBe(true);
	expect(
		Array.isArray(value.report.hops) && value.report.provider === "Sentry",
		`the record carries the same chain for the card — ${JSON.stringify(value.report).slice(0, 200)}`,
	).toBe(true);
	expect(
		JSON.stringify(definition.output.presentationMeta?.({}, value as never)) ===
			JSON.stringify(value.report),
		"and the card is the record, not the text",
	).toBe(true);
	expect(
		textOf(definition, value) === value.summary,
		"the rendered result is the summary the model was promised",
	).toBe(true);

	const missing = (await definition.execute(
		{ provider: "Sentry", ref: "NOPE-1" },
		execution("call-2"),
	)) as {
		summary: string;
		report: {
			title: string;
			hops: unknown[];
			breaks: { reason: string; cause?: string; depth: number }[];
		};
	};

	expect(
		missing.report.hops.length === 0 &&
			missing.report.breaks[0]?.cause === "empty",
		`an id nothing answered with is an empty chain, and says why — ${JSON.stringify(missing.report)}`,
	).toBe(true);
	expect(
		missing.summary.includes("not followed (nothing found)") &&
			missing.summary.includes("the provider knows no such reference"),
		`the text says the same thing, in as many words — ${missing.summary}`,
	).toBe(true);
	expect(
		missing.report.title === "Error NOPE-1",
		`and the card's title is the id it recognized — ${missing.report.title}`,
	).toBe(true);

	const unknown = await definition
		.execute({ provider: "Datadog", ref: "1" }, execution())
		.then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

	expect(
		unknown.includes("Datadog") && unknown.includes("GitLab"),
		`naming an integration that is not installed fails the call, with the list — ${unknown}`,
	).toBe(true);

	const refused = await definition
		.execute({ provider: "GitLab", ref: "42" }, execution("call-3"))
		.then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

	expect(
		refused.includes("group/project!12"),
		`a reference that is not a spelling of that kind is refused before anything is read — ${refused}`,
	).toBe(true);
});

test("reading the record back", () => {
	const good = asChainReport({
		callId: "call-1",
		title: "CHECKOUT-13P · AxiosError",
		provider: "Sentry",
		hops: [
			{
				id: "sentry:CHECKOUT-13P",
				kind: "error",
				label: "Error",
				provider: "Sentry",
				title: "CHECKOUT-13P · AxiosError",
				url: "https://acme.sentry.io/issues/CHECKOUT-13P",
				depth: 0,
			},
		],
		breaks: [
			{
				kind: "task",
				label: "Ticket",
				reason: "not connected",
				cause: "missing",
				depth: 1,
				parent: "sentry:CHECKOUT-13P",
			},
		],
	});

	expect(
		good?.hops.length === 1 &&
			good.hops[0]?.url === "https://acme.sentry.io/issues/CHECKOUT-13P" &&
			good.breaks[0]?.reason === "not connected" &&
			good.breaks[0]?.cause === "missing" &&
			good.breaks[0]?.depth === 1 &&
			good.breaks[0]?.parent === "sentry:CHECKOUT-13P",
		`a well-formed record is read whole — ${JSON.stringify(good)}`,
	).toBe(true);

	expect(
		asChainReport({ callId: "call-1", sections: [] }) === undefined &&
			asChainReport(null) === undefined &&
			asChainReport("a chain") === undefined,
		"a record from something else renders nothing",
	).toBe(true);

	const partial = asChainReport({
		callId: "call-2",
		title: "T",
		provider: "Sentry",
		hops: [
			{ id: "x", kind: "wat", title: "nonsense" },
			{ id: "y", kind: "task", title: "DEV-1" },
		],
		breaks: [{ kind: "commit", reason: "nothing found" }],
	});

	expect(
		partial?.hops.length === 1 &&
			partial.hops[0]?.label === "task" &&
			partial.breaks[0]?.label === "commit",
		`a hop of a kind this version cannot draw is dropped, not guessed — ${JSON.stringify(partial)}`,
	).toBe(true);
});

test("what the text says about a chain that was cut", () => {
	const report = asChainReport({
		callId: "call-cut",
		title: "Error CHECKOUT-13P",
		provider: "Sentry",
		hops: [
			{
				id: "sentry:CHECKOUT-13P",
				kind: "error",
				label: "Error",
				provider: "Sentry",
				title: "CHECKOUT-13P",
				depth: 0,
			},
			{
				id: "gitlab:acme/storefront@7c50a1e5",
				kind: "commit",
				label: "Commit",
				provider: "GitLab",
				title: "7c50a1e5",
				depth: 1,
				parent: "sentry:CHECKOUT-13P",
			},
		],
		breaks: [
			{
				kind: "change",
				label: "Merge request",
				reason: "the chain is capped at 4 levels below the anchor",
				cause: "limit",
				depth: 2,
				parent: "gitlab:acme/storefront@7c50a1e5",
			},
			{
				kind: "task",
				label: "Ticket",
				reason: "the account has no access",
				cause: "auth",
				depth: 1,
				parent: "sentry:CHECKOUT-13P",
			},
		],
		limits: { depth: 4, facts: 40 },
		coverage: [
			{
				kind: "commit",
				providers: ["GitLab", "Gitea"],
				answeredBy: "GitLab",
			},
		],
	});

	const summary = chainSummary(report as never);

	expect(
		summary.includes("2 hops, 2 not followed"),
		`the text ends with how much of the chain it holds — ${summary}`,
	).toBe(true);
	expect(
		summary.includes("(capped)") && summary.includes("(access denied)"),
		`each break carries the class of its failure — ${summary}`,
	).toBe(true);
	expect(
		summary.indexOf("Ticket not followed") < summary.indexOf("Commit · GitLab"),
		`a break of the anchor comes before the hops that follow it — ${summary}`,
	).toBe(true);
	expect(
		summary.indexOf("2. Commit") <
			summary.indexOf("Merge request not followed"),
		`a break sits after the hop that named it — ${summary}`,
	).toBe(true);
	expect(
		summary.includes("capped at 4 levels and 40 hops"),
		`the walk's caps are named with their numbers — ${summary}`,
	).toBe(true);
	expect(
		summary.includes(
			"commit references can be resolved by GitLab, Gitea; GitLab answered, Gitea was not asked.",
		),
		`when two integrations could answer a kind, the text says which one did — ${summary}`,
	).toBe(true);
});

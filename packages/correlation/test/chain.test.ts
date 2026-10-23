/**
 * The walk, against fakes.
 *
 * The walk's whole job is to be honest about where a chain stopped, and every
 * way it can stop is a pure decision here: nothing was installed, a provider
 * refused, a provider found nothing, or the chain ran past its own bounds. No
 * live endpoint is touched, so the file runs anywhere.
 *
 *   bun run test/chain.ts
 */

import { expect, test } from "bun:test";
import type {
	CorrelationFact,
	CorrelationKind,
} from "dsh-integration-host/correlation";
import { anchorFor } from "../src/host/anchor";
import { buildChain, type ChainResolver, refKey } from "../src/host/chain";

/** What one fake provider offers. */
interface FakeProvider {
	readonly provider: string;
	readonly entry: CorrelationKind;
	readonly resolves: readonly CorrelationKind[];
}

/** A registry of fakes, answering from a table of references. */
function fake(
	providers: readonly FakeProvider[],
	answers: Readonly<Record<string, readonly CorrelationFact[]>>,
): ChainResolver {
	return {
		providers,
		entryOf: (provider) =>
			providers.find((item) => item.provider === provider)?.entry,
		canResolve: (kind) =>
			providers.some((item) => item.resolves.includes(kind)),
		resolve: async (ref) => answers[refKey(ref)] ?? [],
	};
}

const SENTRY: FakeProvider = {
	provider: "Sentry",
	entry: "error",
	resolves: ["error"],
};
const GITLAB: FakeProvider = {
	provider: "GitLab",
	entry: "change",
	resolves: ["commit", "change"],
};
const ATLASSIAN: FakeProvider = {
	provider: "Atlassian",
	entry: "task",
	resolves: ["task"],
};

test("what the user typed", () => {
	expect(
		JSON.stringify(anchorFor("error", " CHECKOUT-13P ")) ===
			JSON.stringify({ kind: "error", id: "CHECKOUT-13P" }),
		"a short id is an issue as it stands",
	).toBe(true);
	expect(
		JSON.stringify(
			anchorFor("error", "https://acme.sentry.io/issues/CHECKOUT-13P/"),
		) === JSON.stringify({ kind: "error", id: "CHECKOUT-13P" }),
		"a pasted link is trimmed to the id at its end",
	).toBe(true);
	expect(
		JSON.stringify(
			anchorFor(
				"commit",
				"https://gitlab.com/acme/storefront/-/commit/7C50A1E5",
			),
		) ===
			JSON.stringify({
				kind: "commit",
				sha: "7c50a1e5",
				url: "https://gitlab.com/acme/storefront/-/commit/7C50A1E5",
			}),
		"a commit is read as its sha, and a link keeps the link",
	).toBe(true);
	expect(
		JSON.stringify(anchorFor("change", "acme/storefront!42")) ===
			JSON.stringify({
				kind: "change",
				repository: "acme/storefront",
				number: "42",
			}),
		"a change request is the project path and its number",
	).toBe(true);
	expect(
		JSON.stringify(anchorFor("task", "dev-5977")) ===
			JSON.stringify({ kind: "task", key: "DEV-5977" }),
		"a tracker key is case-folded",
	).toBe(true);

	for (const [kind, text] of [
		["commit", "main"],
		["change", "42"],
		["task", "the exchange fix"],
		["error", "  "],
	] as const) {
		const message = (() => {
			try {
				anchorFor(kind, text);

				return "";
			} catch (error) {
				return (error as Error).message;
			}
		})();

		expect(
			message !== "",
			String(`"${text}" is refused as a ${kind}`) + " — " + message,
		).toBe(true);
	}
});

test("walking a chain", async () => {
	const sources = fake([SENTRY, GITLAB, ATLASSIAN], {
		"error:CHECKOUT-13P": [
			{
				id: "sentry:CHECKOUT-13P",
				provider: "Sentry",
				kind: "error",
				label: "Error",
				title: "CHECKOUT-13P · AxiosError: 422",
				url: "https://acme.sentry.io/issues/CHECKOUT-13P",
				meta: "unresolved · 35 events",
				references: [
					{
						kind: "commit",
						sha: "7c50a1e5",
						repository: "Acme / storefront",
						label: "Suspect commit",
					},
					{ kind: "task", key: "DEV-5977" },
				],
			},
		],
		"commit:7c50a1e5@Acme / storefront": [
			{
				id: "gitlab:acme/storefront@7c50a1e5",
				provider: "GitLab",
				kind: "commit",
				label: "Commit",
				title: "7c50a1e5 · DEV-5977: Handle split codes",
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
				title: "acme/storefront!42 · Fix the split",
				meta: "opened · Ada Lovelace",
				references: [{ kind: "task", key: "DEV-5977", label: "DEV-5977" }],
			},
		],
		"task:DEV-5977": [
			{
				id: "jira:DEV-5977",
				provider: "Atlassian",
				kind: "task",
				label: "Jira issue",
				title: "DEV-5977 · Fix the exchange step",
				url: "https://acme.atlassian.net/browse/DEV-5977",
				meta: "In review · Ada Lovelace",
			},
		],
	});

	const report = await buildChain(sources, {
		callId: "call-1",
		provider: "Sentry",
		ref: "CHECKOUT-13P",
	});

	expect(
		report.hops.map((hop) => hop.kind).join(" → ") ===
			"error → commit → change → task",
		`the chain reads as one chain: error, commit, merge request, ticket — ${report.hops.map((hop) => hop.kind).join(" → ")}`,
	).toBe(true);
	expect(
		report.hops.map((hop) => hop.depth).join(",") === "0,1,2,3",
		`each hop knows how far from the anchor it sits — ${report.hops.map((hop) => hop.depth).join(",")}`,
	).toBe(true);
	expect(
		report.title === "CHECKOUT-13P · AxiosError: 422" &&
			report.provider === "Sentry",
		`the card is titled by the anchor's own provider — ${`${report.provider} · ${report.title}`}`,
	).toBe(true);
	expect(
		report.hops.every((hop) => hop.provider !== ""),
		"every hop answered by the provider that owns it",
	).toBe(true);
	expect(
		report.breaks.length === 0,
		`a chain that was followed whole reports no breaks — ${JSON.stringify(report.breaks)}`,
	).toBe(true);
	expect(
		report.hops.filter((hop) => hop.id === "jira:DEV-5977").length === 1,
		"the ticket found through the commit is not asked for twice",
	).toBe(true);
});

test("where a chain stops", async () => {
	const unowned = await buildChain(
		fake([SENTRY], {
			"error:CHECKOUT-13P": [
				{
					id: "sentry:CHECKOUT-13P",
					provider: "Sentry",
					kind: "error",
					label: "Error",
					title: "CHECKOUT-13P · AxiosError: 422",
					references: [{ kind: "commit", sha: "7c50a1e5" }],
				},
			],
		}),
		{ callId: "call-2", provider: "Sentry", ref: "CHECKOUT-13P" },
	);

	expect(
		unowned.breaks[0]?.reason === "no installed integration resolves this" &&
			unowned.breaks[0]?.label === "Commit",
		`a hop no installed integration resolves says so — ${JSON.stringify(unowned.breaks)}`,
	).toBe(true);

	const refused = await buildChain(
		{
			...fake([SENTRY, ATLASSIAN], { "task:DEV-5977": [] }),
			resolve: async () => {
				throw new Error("GitLab refused the request (403)");
			},
		},
		{ callId: "call-3", provider: "Sentry", ref: "CHECKOUT-13P" },
	);

	expect(
		refused.breaks[0]?.reason === "GitLab refused the request (403)",
		`a provider that refuses is quoted, not swallowed — ${JSON.stringify(refused.breaks)}`,
	).toBe(true);

	const nothing = await buildChain(
		fake([SENTRY, ATLASSIAN], { "error:CHECKOUT-13P": [] }),
		{ callId: "call-4", provider: "Sentry", ref: "CHECKOUT-13P" },
	);

	expect(
		nothing.breaks[0]?.reason === "nothing found",
		`a provider that knows nothing says that instead — ${JSON.stringify(nothing.breaks)}`,
	).toBe(true);

	const deep = await buildChain(
		fake([SENTRY, GITLAB, ATLASSIAN], {
			"error:CHECKOUT-13P": [
				{
					id: "sentry:CHECKOUT-13P",
					provider: "Sentry",
					kind: "error",
					label: "Error",
					title: "CHECKOUT-13P",
					references: [{ kind: "commit", sha: "7c50a1e5" }],
				},
			],
			"commit:7c50a1e5@": [
				{
					id: "gitlab:acme/storefront@7c50a1e5",
					provider: "GitLab",
					kind: "commit",
					label: "Commit",
					title: "7c50a1e5",
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
					title: "acme/storefront!42",
					references: [{ kind: "task", key: "DEV-5977" }],
				},
			],
			"task:DEV-5977": [
				{
					id: "jira:DEV-5977",
					provider: "Atlassian",
					kind: "task",
					label: "Jira issue",
					title: "DEV-5977",
				},
			],
		}),
		{ callId: "call-5", provider: "Sentry", ref: "CHECKOUT-13P" },
		{ depth: 2, facts: 40 },
	);

	expect(
		deep.hops.length === 3 &&
			deep.breaks.some(
				(item) => item.reason === "deeper than this answer follows",
			),
		`a chain deeper than the walk follows stops with a reason — ${`${String(deep.hops.length)} hops · ${JSON.stringify(deep.breaks)}`}`,
	).toBe(true);

	const commit = (sha: string): CorrelationFact => ({
		id: `gitlab:acme/storefront@${sha}`,
		provider: "GitLab",
		kind: "commit",
		label: "Commit",
		title: sha,
	});

	const capped = await buildChain(
		fake([SENTRY, GITLAB], {
			"error:CHECKOUT-13P": [
				{
					id: "sentry:CHECKOUT-13P",
					provider: "Sentry",
					kind: "error",
					label: "Error",
					title: "CHECKOUT-13P",
					references: [
						{ kind: "commit", sha: "7c50a1e5" },
						{ kind: "commit", sha: "aaaaaaa" },
					],
				},
			],
			"commit:7c50a1e5@": [commit("7c50a1e5")],
			"commit:aaaaaaa@": [commit("aaaaaaa")],
		}),
		{ callId: "call-6", provider: "Sentry", ref: "CHECKOUT-13P" },
		{ depth: 4, facts: 1 },
	);

	expect(
		capped.hops.length === 1 &&
			capped.breaks.some(
				(item) =>
					item.reason === "the chain is longer than this answer follows",
			),
		`a chain longer than the answer holds says it was cut — ${`${String(capped.hops.length)} hops · ${JSON.stringify(capped.breaks)}`}`,
	).toBe(true);

	const unknown = await buildChain(fake([SENTRY], {}), {
		callId: "call-7",
		provider: "Datadog",
		ref: "1",
	}).then(
		() => "",
		(error: unknown) => (error as Error).message,
	);

	expect(
		unknown.includes("Datadog") && unknown.includes("Sentry"),
		`naming an integration that is not installed lists the ones that are — ${unknown}`,
	).toBe(true);
});

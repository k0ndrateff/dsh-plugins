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
import { type AnchorSpec, anchorFor } from "../src/host/anchor";
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

const SENTRY_ANCHOR: AnchorSpec = {
	provider: "Sentry",
	entry: "error",
	resolves: ["error"],
};
const GITLAB_ANCHOR: AnchorSpec = {
	provider: "GitLab",
	entry: "change",
	resolves: ["commit", "change"],
};
const ATLASSIAN_ANCHOR: AnchorSpec = {
	provider: "Atlassian",
	entry: "task",
	resolves: ["task"],
};

test("what the user typed", () => {
	expect(
		JSON.stringify(anchorFor(SENTRY_ANCHOR, " CHECKOUT-13P ")) ===
			JSON.stringify({ kind: "error", id: "CHECKOUT-13P" }),
		"a short id is an issue as it stands",
	).toBe(true);
	expect(
		JSON.stringify(
			anchorFor(SENTRY_ANCHOR, "https://acme.sentry.io/issues/CHECKOUT-13P/"),
		) === JSON.stringify({ kind: "error", id: "CHECKOUT-13P" }),
		"a pasted link is trimmed to the id at its end",
	).toBe(true);
	expect(
		JSON.stringify(anchorFor(GITLAB_ANCHOR, "acme/storefront!42")) ===
			JSON.stringify({
				kind: "change",
				repository: "acme/storefront",
				number: "42",
			}),
		"the integration's own entry kind is read first",
	).toBe(true);
	expect(
		JSON.stringify(
			anchorFor(
				GITLAB_ANCHOR,
				"https://gitlab.com/acme/storefront/-/commit/7C50A1E5",
			),
		) ===
			JSON.stringify({
				kind: "commit",
				sha: "7c50a1e5",
				url: "https://gitlab.com/acme/storefront/-/commit/7C50A1E5",
			}),
		`a merge request or a commit both start a code-host chain — ${JSON.stringify(anchorFor(GITLAB_ANCHOR, "7c50a1e5"))}`,
	).toBe(true);
	expect(
		JSON.stringify(anchorFor(ATLASSIAN_ANCHOR, "dev-5977")) ===
			JSON.stringify({ kind: "task", key: "DEV-5977" }),
		"a tracker key is case-folded",
	).toBe(true);

	for (const [spec, text] of [
		[GITLAB_ANCHOR, "main"],
		[GITLAB_ANCHOR, "42"],
		[ATLASSIAN_ANCHOR, "the exchange fix"],
		[SENTRY_ANCHOR, "  "],
		[SENTRY_ANCHOR, "7c50a1e5"],
	] as const) {
		const message = (() => {
			try {
				anchorFor(spec, text);

				return "";
			} catch (error) {
				return (error as Error).message;
			}
		})();

		expect(
			message !== "",
			`"${text}" is refused by ${spec.provider} — ${message}`,
		).toBe(true);
	}

	const refusedSha = (() => {
		try {
			anchorFor(SENTRY_ANCHOR, "7c50a1e5");

			return "";
		} catch (error) {
			return (error as Error).message;
		}
	})();

	expect(
		refusedSha.includes("not an issue id") &&
			refusedSha.includes("a Sentry issue short id"),
		`a commit sha is refused by an integration that starts from errors, with what it does accept — ${refusedSha}`,
	).toBe(true);

	const gitlab = (() => {
		try {
			anchorFor(GITLAB_ANCHOR, "main");

			return "";
		} catch (error) {
			return (error as Error).message;
		}
	})();

	expect(
		gitlab.includes("group/project!12") && gitlab.includes("commit sha"),
		`the refusal names every form the integration starts from — ${gitlab}`,
	).toBe(true);
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
			unowned.breaks[0]?.label === "Commit" &&
			unowned.breaks[0]?.cause === "missing",
		`a hop no installed integration resolves says so, and in which class — ${JSON.stringify(unowned.breaks)}`,
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
		refused.breaks[0]?.reason === "GitLab refused the request (403)" &&
			refused.breaks[0]?.cause === "auth",
		`a provider that refuses is quoted, not swallowed, and 403 reads as an access problem — ${JSON.stringify(refused.breaks)}`,
	).toBe(true);

	const nothing = await buildChain(
		fake([SENTRY, ATLASSIAN], { "error:CHECKOUT-13P": [] }),
		{ callId: "call-4", provider: "Sentry", ref: "CHECKOUT-13P" },
	);

	expect(
		nothing.breaks[0]?.cause === "empty" &&
			nothing.breaks[0]?.reason === "the provider knows no such reference",
		`a provider that knows nothing says that instead — ${JSON.stringify(nothing.breaks)}`,
	).toBe(true);
	expect(
		nothing.title === "Error CHECKOUT-13P",
		`an anchor nothing resolved is still titled by the id it recognized, not by the raw text — ${nothing.title}`,
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
				(item) =>
					item.cause === "limit" &&
					item.reason === "the chain is capped at 2 levels below the anchor",
			),
		`a chain deeper than the walk follows stops with the cap it hit — ${`${String(deep.hops.length)} hops · ${JSON.stringify(deep.breaks)}`}`,
	).toBe(true);
	expect(
		deep.breaks.every((item) => item.depth === 3 && item.parent !== undefined),
		`a capped branch says which hop pointed at it and how deep — ${JSON.stringify(deep.breaks)}`,
	).toBe(true);
	expect(
		deep.limits?.depth === 2 && deep.limits?.facts === 40,
		`the report carries the bounds it ran under — ${JSON.stringify(deep.limits)}`,
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
					item.cause === "limit" &&
					item.reason === "the chain is capped at 1 hops",
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

test("a branch is drawn where it broke", async () => {
	const sources = fake([SENTRY, GITLAB, ATLASSIAN], {
		"error:CHECKOUT-13P": [
			{
				id: "sentry:CHECKOUT-13P",
				provider: "Sentry",
				kind: "error",
				label: "Error",
				title: "CHECKOUT-13P · AxiosError",
				references: [
					{ kind: "commit", sha: "7c50a1e5" },
					{ kind: "task", key: "DEV-5977" },
					{ kind: "change", repository: "acme/storefront", number: "77" },
				],
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
	});

	const report = await buildChain(sources, {
		callId: "call-branch",
		provider: "Sentry",
		ref: "CHECKOUT-13P",
	});

	const unresolved = report.breaks.find(
		(item) => item.kind === "change" && item.parent === "sentry:CHECKOUT-13P",
	);

	expect(
		report.hops.map((hop) => `${hop.kind}@${hop.depth}`).join(" → ") ===
			"error@0 → commit@1 → change@2 → task@1",
		`each hop knows its level and its parent, so the branch is visible — ${report.hops.map((hop) => `${hop.id}@${hop.depth}${hop.parent === undefined ? "" : `<${hop.parent}`}`).join(" → ")}`,
	).toBe(true);
	expect(
		unresolved?.cause === "empty" && unresolved.depth === 1,
		`a reference of the anchor that nothing answered hangs off the anchor at level one — ${JSON.stringify(unresolved)}`,
	).toBe(true);
});

test("an unreachable anchor still reads as an id", async () => {
	const report = await buildChain(fake([SENTRY], {}), {
		callId: "call-miss",
		provider: "Sentry",
		ref: "NOPE-1",
	});

	expect(
		report.title === "Error NOPE-1" && report.hops.length === 0,
		`the card is titled by the recognized id, not by a long pasted link — ${report.title}`,
	).toBe(true);
});

test("a kind two integrations resolve says so", async () => {
	const gitea: FakeProvider = {
		provider: "Gitea",
		entry: "change",
		resolves: ["commit", "change"],
	};
	const report = await buildChain(
		fake([SENTRY, GITLAB, gitea], {
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
				},
			],
		}),
		{ callId: "call-cover", provider: "Sentry", ref: "CHECKOUT-13P" },
	);

	const commit = report.coverage?.find((item) => item.kind === "commit");

	expect(
		commit?.providers.join(",") === "GitLab,Gitea" &&
			commit.answeredBy === "GitLab",
		`a kind two integrations could answer reports who did — ${JSON.stringify(report.coverage)}`,
	).toBe(true);
});

test("a code host starts from a commit as well as a merge request", async () => {
	const report = await buildChain(
		fake([GITLAB], {
			"commit:7c50a1e5@": [
				{
					id: "gitlab:acme/storefront@7c50a1e5",
					provider: "GitLab",
					kind: "commit",
					label: "Commit",
					title: "7c50a1e5 · Fix the split",
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
				},
			],
		}),
		{ callId: "call-commit", provider: "GitLab", ref: "7c50a1e5" },
	);

	expect(
		report.hops[0]?.kind === "commit" &&
			report.hops[1]?.kind === "change" &&
			report.title === "7c50a1e5 · Fix the split",
		`a chain can start at the commit the question is about — ${report.hops.map((hop) => hop.kind).join(" → ")}`,
	).toBe(true);
});

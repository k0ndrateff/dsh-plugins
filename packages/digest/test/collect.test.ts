/**
 * Assembling a digest: which blocks are asked for, in what order, and what a
 * provider that cannot answer costs.
 *
 *   bun run test/collect.ts
 *
 * The registry is faked at the seam the collector uses — `ctx.get("digestSources")`
 * — so the test proves the composition rule without an integration installed:
 * the switches decide what is asked for, one block's failure is that block's,
 * and the model's text says the same thing as the card.
 */

import { test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import type { DigestBlockEntry, DigestItem } from "dsh-integration-host";
import { check } from "../../../test/support";
import { DigestCollector } from "../src/host/collect";
import {
	DigestSettingsStore,
	defaultDigestSettings,
} from "../src/host/settings";

/** What one load was asked for. */
interface Asked {
	readonly block: string;
	readonly limit: number;
	readonly sinceMs: number;
}

/** A registry of sources that answer from a script. */
class FakeSources {
	readonly asked: Asked[] = [];

	constructor(
		readonly blocks: readonly DigestBlockEntry[],
		private readonly answers: Readonly<
			Record<string, readonly DigestItem[] | Error>
		>,
	) {}

	async load(
		blockId: string,
		options: { since: Date; limit: number },
	): Promise<readonly DigestItem[]> {
		this.asked.push({
			block: blockId,
			limit: options.limit,
			sinceMs: options.since.getTime(),
		});

		const answer = this.answers[blockId];

		if (answer instanceof Error) throw answer;
		if (answer === undefined) throw new Error("no answer scripted");

		return answer;
	}
}

/** A context whose digest registry is the fake, when one is given. */
const contextWith = (sources: FakeSources | undefined): Context =>
	({
		get: (name: string) => (name === "digestSources" ? sources : undefined),
	}) as unknown as Context;

/** A registry that answers one block with one row and fails another. */
const sourcesFor = (): FakeSources =>
	new FakeSources(
		[
			{
				id: "jira-active",
				title: "Jira · In progress",
				provider: "Atlassian",
				defaultOn: true,
			},
			{
				id: "gitlab-review",
				title: "GitLab · Waiting",
				provider: "GitLab",
				defaultOn: true,
			},
			{
				id: "coderabbit",
				title: "GitLab · CodeRabbit",
				provider: "GitLab",
				defaultOn: false,
			},
		],
		{
			"jira-active": [
				{
					id: "DEV-1",
					title: "DEV-1 · Fix it",
					url: "https://x/DEV-1",
					meta: "In Progress",
				},
			],
			"gitlab-review": new Error(
				"the GitLab account is not known yet; run /gitlab sync",
			),
			coderabbit: [{ id: "mr#1", title: "Consider a guard clause" }],
		},
	);

const NOW = new Date("2026-10-21T06:00:00.000Z");

/**
 * A settings store that answers from memory.
 *
 * The collector never writes, so a suite that proves what it asks for has no
 * business touching a disk: the document is handed to the store directly.
 */
const storeWith = (blocks: Record<string, boolean> = {}): DigestSettingsStore =>
	new DigestSettingsStore("unused.json", {
		...defaultDigestSettings(),
		blocks,
	});

test("what is asked for", async () => {
	{
		const sources = sourcesFor();
		const store = storeWith();
		const collector = new DigestCollector({
			ctx: contextWith(sources),
			settings: store,
		});

		const { report: digest } = await collector.collect("call-1", NOW);

		check(
			"only the switched-on blocks are asked for",
			sources.asked.map((entry) => entry.block).join(",") ===
				"jira-active,gitlab-review",
			sources.asked.map((entry) => entry.block).join(","),
		);
		check(
			"the window is the last day",
			sources.asked.every(
				(entry) => entry.sinceMs === NOW.getTime() - 86_400_000,
			),
			String(sources.asked[0]?.sinceMs),
		);
		check(
			"the row cap is passed through",
			sources.asked.every((entry) => entry.limit === 10),
		);
		check(
			"the report keeps the sources' order",
			digest.sections.map((s) => s.block).join(",") ===
				"jira-active,gitlab-review",
		);
		check("the call id is the card's identity", digest.callId === "call-1");
		check("the moment is recorded", digest.generatedAt === NOW.toISOString());

		const switched = await new DigestCollector({
			ctx: contextWith(sources),
			settings: storeWith({ "jira-active": false, coderabbit: true }),
		}).collect("call-2", NOW);

		check(
			"a saved switch overrides the declared default in both directions",
			switched.report.sections.map((s) => s.block).join(",") ===
				"gitlab-review,coderabbit",
			switched.report.sections.map((s) => s.block).join(","),
		);
	}
});
test("one block failing is that block's problem", async () => {
	{
		const sources = sourcesFor();
		const collector = new DigestCollector({
			ctx: contextWith(sources),
			settings: storeWith(),
		});

		const { report: digest, summary } = await collector.collect("call-3", NOW);
		const jira = digest.sections.find((s) => s.block === "jira-active");
		const gitlab = digest.sections.find((s) => s.block === "gitlab-review");

		check("the block that answered keeps its rows", jira?.items.length === 1);
		check("the block that failed has none", gitlab?.items.length === 0);
		check(
			"and says why, in the provider's own words",
			gitlab?.unavailable ===
				"the GitLab account is not known yet; run /gitlab sync",
			gitlab?.unavailable,
		);
		check(
			"the model's text names the reason too",
			summary.includes("unavailable: the GitLab account"),
		);
		check(
			"an empty block is not confused with an unavailable one",
			summary.includes("## Jira · In progress (1)"),
		);
	}
});
test("a deployment with no sources at all", async () => {
	{
		const collector = new DigestCollector({
			ctx: contextWith(undefined),
			settings: storeWith(),
		});

		const { report: digest, summary } = await collector.collect("call-4", NOW);

		check(
			"the report is empty rather than an error",
			digest.sections.length === 0,
		);
		check("the text says so", summary.includes("0 blocks"));
		check(
			"and nothing is offered to switch on",
			collector.sources().length === 0,
		);
	}
});

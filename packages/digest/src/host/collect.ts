/**
 * Assembling one digest.
 *
 * The collector is deliberately dumb: it asks the registry which blocks exist,
 * drops the ones the user switched off, loads the rest in parallel, and lays
 * the answers out. It does not ask a model anything and it does not write
 * anywhere — a digest arrives on a schedule, with nobody watching, so a day
 * when a provider is down has to produce a digest that says so rather than one
 * that guesses.
 *
 * One block failing is never allowed to fail the digest. The reason is kept
 * against that block, because "GitLab is not connected" and "nothing is waiting
 * for your review" are different facts and a reader needs to tell them apart.
 */

import type { Context } from "@deepseek-ai/cordis";
import { errorText } from "dsh-mcp-oauth";
import type {
	DigestBlockEntry,
	DigestItem,
	DigestReport,
	DigestSection,
} from "../shared/digest";
import { digestTitle } from "../shared/digest";
import type { DigestSettingsStore } from "./settings";

/** How far back a block that reports recent work looks. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Everything the collector reads through. */
export interface DigestCollectDeps {
	readonly ctx: Context;
	readonly settings: DigestSettingsStore;
}

/** One assembled digest, and the text the model reads instead of the card. */
export interface DigestCollected {
	readonly summary: string;
	readonly report: DigestReport;
}

export class DigestCollector {
	constructor(private readonly deps: DigestCollectDeps) {}

	/**
	 * The blocks the installed integrations offer, in registration order.
	 *
	 * The command and the settings card both draw from this rather than keeping
	 * their own idea of which blocks exist: a provider that is uninstalled stops
	 * appearing, and one that is added appears with its own declared default.
	 */
	sources(): readonly DigestBlockEntry[] {
		return this.deps.ctx.get("digestSources")?.blocks ?? [];
	}

	/**
	 * Assemble the digest the user configured.
	 * @param callId - the call the report belongs to; the card's identity.
	 * @param now - the instant the digest is being assembled at.
	 * @returns the report, and the text the model reads.
	 */
	async collect(callId: string, now: Date): Promise<DigestCollected> {
		const settings = await this.deps.settings.ensure();
		const report: DigestReport = {
			callId,
			title: digestTitle(settings.days),
			generatedAt: now.toISOString(),
			sections: await this.sections(now),
		};

		return { summary: this.text(report), report };
	}

	/** One section per block the user kept, in the order the sources declared. */
	private async sections(now: Date): Promise<readonly DigestSection[]> {
		const sources = this.deps.ctx.get("digestSources");

		if (sources === undefined) return [];

		const settings = await this.deps.settings.ensure();
		const options = {
			since: new Date(now.getTime() - WINDOW_MS),
			limit: settings.limit,
		};
		const switches = this.deps.settings.switches(sources.blocks);
		const kept = sources.blocks.filter((block) => switches[block.id] === true);

		return await Promise.all(
			kept.map(async (block): Promise<DigestSection> => {
				const head = {
					block: block.id,
					title: block.title,
					provider: block.provider,
				};

				try {
					const items = await sources.load(block.id, options);

					return { ...head, items: [...items] };
				} catch (error) {
					return { ...head, items: [], unavailable: errorText(error) };
				}
			}),
		);
	}

	/** The digest as the model reads it: what the card shows, in order. */
	private text(report: DigestReport): string {
		const rows = report.sections.reduce(
			(total, section) => total + section.items.length,
			0,
		);
		const lines = [
			`Digest assembled at ${new Date(report.generatedAt).toLocaleString()}: ${report.sections.length} block${report.sections.length === 1 ? "" : "s"}, ${rows} row${rows === 1 ? "" : "s"}.`,
		];

		for (const section of report.sections) {
			if (section.unavailable !== undefined) {
				lines.push(`## ${section.title} — unavailable: ${section.unavailable}`);

				continue;
			}

			lines.push(
				`## ${section.title} (${section.items.length})`,
				...(section.items.length === 0
					? ["- nothing to report"]
					: section.items.map((item) => this.row(item))),
			);
		}

		return lines.join("\n");
	}

	/** One row, as a line the model can quote. */
	private row(item: DigestItem): string {
		const meta = item.meta === undefined ? "" : ` — ${item.meta}`;
		const url = item.url === undefined ? "" : ` — ${item.url}`;

		return `- ${item.title}${meta}${url}`;
	}
}

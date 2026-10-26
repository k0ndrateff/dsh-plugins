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
import {
	type DigestBlockView,
	type DigestSettings,
	digestStamp,
	digestTitle,
	emptyDigestNote,
} from "../shared/digest";
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
	 * @param settings - the configuration to assemble under; the saved one when
	 *   omitted. The settings card passes its draft here, so "Show now" previews
	 *   what the user is about to save rather than what was saved before.
	 * @returns the report, and the text the model reads.
	 */
	async collect(
		callId: string,
		now: Date,
		settings?: DigestSettings,
	): Promise<DigestCollected> {
		const current = settings ?? (await this.deps.settings.ensure());
		const offered = this.offered(current);
		const report: DigestReport = {
			callId,
			title: digestTitle(current.days),
			generatedAt: now.toISOString(),
			timeZone: current.timeZone,
			offered,
			sections: await this.sections(now, current, offered),
		};

		return { summary: this.text(report), report };
	}

	/** Every block on offer, with the switch this configuration gives it. */
	offered(settings: DigestSettings): readonly DigestBlockView[] {
		return this.sources().map((block) => ({
			id: block.id,
			title: block.title,
			provider: block.provider,
			on: settings.blocks[block.id] ?? block.defaultOn,
		}));
	}

	/** One section per block the user kept, in the order the sources declared. */
	private async sections(
		now: Date,
		settings: DigestSettings,
		offered: readonly DigestBlockView[],
	): Promise<readonly DigestSection[]> {
		const sources = this.deps.ctx.get("digestSources");

		if (sources === undefined) return [];

		const kept = offered.filter((block) => block.on);

		return await Promise.all(
			kept.map(async (block): Promise<DigestSection> => {
				const head = {
					block: block.id,
					title: block.title,
					provider: block.provider,
				};

				try {
					// One row past the cap is the only way the wire contract lets a
					// block say "there is more"; the extra row is never shown.
					const rows = await sources.load(block.id, {
						since: new Date(now.getTime() - WINDOW_MS),
						limit: settings.limit + 1,
					});

					if (rows.length <= settings.limit)
						return { ...head, items: [...rows] };

					return {
						...head,
						items: rows.slice(0, settings.limit),
						truncated: true,
						total: rows.length,
					};
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
			`Digest assembled at ${digestStamp(report.generatedAt, report.timeZone)}: ${report.sections.length} block${report.sections.length === 1 ? "" : "s"}, ${rows} row${rows === 1 ? "" : "s"}.`,
		];

		if (report.sections.length === 0 && report.offered !== undefined)
			lines.push("", emptyDigestNote(report.offered));

		for (const section of report.sections) {
			if (section.unavailable !== undefined) {
				lines.push(`## ${section.title} — unavailable: ${section.unavailable}`);

				continue;
			}

			lines.push(
				`## ${this.heading(section)}`,
				...(section.items.length === 0
					? ["- nothing to report"]
					: section.items.map((item) => this.row(item))),
			);
		}

		const cut = report.sections.find((section) => section.truncated === true);

		if (cut !== undefined)
			lines.push(
				"",
				`Some blocks had more rows than shown; the digest shows up to ${cut.items.length} rows per block — raise Rows per block in Settings → Digest to see more.`,
			);

		return lines.join("\n");
	}

	/** A block's heading, with how much of it the reader is seeing. */
	private heading(section: DigestSection): string {
		if (section.truncated !== true || section.total === undefined)
			return `${section.title} (${section.items.length})`;

		return `${section.title} (${section.items.length} of at least ${section.total})`;
	}

	/** One row, as a line the model can quote. */
	private row(item: DigestItem): string {
		const meta = item.meta === undefined ? "" : ` — ${item.meta}`;
		const url = item.url === undefined ? "" : ` — ${item.url}`;

		return `- ${item.title}${meta}${url}`;
	}
}

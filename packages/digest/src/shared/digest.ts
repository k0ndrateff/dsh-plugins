/**
 * What a digest is, on both sides of the wire.
 *
 * The host half assembles one of these from whatever digest sources the
 * installed integrations registered, records it as the `digest` tool result's
 * `presentationMeta`, and the browser half narrows it out of the persisted
 * result to draw the card under the agent's answer. Both halves import these
 * types and each bundle inlines its own copy — a type-only contract, not shared
 * runtime state.
 *
 * A row is deliberately small. A digest is read at a glance on a morning when
 * nobody wants to open five systems, so a row carries one line, a link, and one
 * supporting detail, and the card gives it no more room than that.
 */

import type { DigestBlockEntry, DigestItem } from "dsh-integration-host/digest";

export type { DigestBlockEntry, DigestItem };

/** One block of the digest, as the card shows it. */
export interface DigestSection {
	/** The block id its switch is stored under. */
	readonly block: string;
	/** The block's heading, as its provider declared it. */
	readonly title: string;
	/** The provider that owns the block, such as `GitLab`. */
	readonly provider: string;
	readonly items: readonly DigestItem[];
	/**
	 * Why the block has nothing, when it could not be read at all.
	 *
	 * Absent means the provider answered: an empty list is then a truthful
	 * "nothing to report", which reads very differently from "GitLab is not
	 * connected".
	 */
	readonly unavailable?: string;
}

/** One assembled digest. */
export interface DigestReport {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
	readonly title: string;
	/** When it was assembled, as an ISO instant. */
	readonly generatedAt: string;
	readonly sections: readonly DigestSection[];
}

/** How many rows one block may contribute. */
export const DIGEST_LIMITS = [5, 10, 15, 25] as const;

/** The default row cap, until a user picks another. */
export const DEFAULT_DIGEST_LIMIT = 10;

/**
 * The user's digest configuration.
 *
 * There is no "enabled" flag here: a reminder belongs to a session, and which
 * sessions receive the digest is decided by `/digest on` in each of them. This
 * is what the digest says and when it should be delivered.
 */
export interface DigestSettings {
	/** Local wall-clock time, `HH:MM`. */
	readonly time: string;
	/** Delivery days, as JS weekday numbers (0 = Sunday). */
	readonly days: readonly number[];
	/** The IANA zone `time` is read in. */
	readonly timeZone: string;
	/** Saved switches, by block id; a block with no entry keeps its default. */
	readonly blocks: Readonly<Record<string, boolean>>;
	/** The most rows one block may contribute. */
	readonly limit: number;
}

/** A wall-clock time, `HH:MM`, in 24-hour form. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/**
 * Whether one string is a wall-clock time this plugin will schedule.
 *
 * The card and the command both refuse a time the other would, so the rule lives
 * where both halves can read it rather than being written twice.
 */
export const isDigestTime = (value: unknown): value is string =>
	typeof value === "string" && TIME.test(value);

/**
 * Whether one string names a zone `Intl` knows.
 *
 * Asking `Intl` is the whole check: the list of zone names is the runtime's, and
 * a copy of it here would be wrong the next time a country changes its mind.
 */
export const isTimeZone = (value: unknown): value is string => {
	if (typeof value !== "string" || value === "") return false;

	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();

		return true;
	} catch {
		return false;
	}
};

/** One block as the settings card draws it. */
export interface DigestBlockView {
	readonly id: string;
	readonly title: string;
	readonly provider: string;
	readonly on: boolean;
}

/** Everything the settings card reads from the host. */
export interface DigestSettingsView {
	readonly settings: DigestSettings;
	/** The blocks the installed sources offer, in registration order. */
	readonly blocks: readonly DigestBlockView[];
	/** The providers that registered, in registration order. */
	readonly providers: readonly string[];
	/** How many digest reminders are currently bound, across every session. */
	readonly scheduled: number;
	/** Whether this deployment composes the reminder service at all. */
	readonly canSchedule: boolean;
}

/** The weekday names, in JS order, for the card's day row. */
export const DAY_LABELS = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Narrow one opaque record payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the report, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool keeps a text
 *   result as the source of truth for the model.
 */
export function asDigestReport(value: unknown): DigestReport | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (typeof value.generatedAt !== "string") return undefined;
	if (!Array.isArray(value.sections)) return undefined;

	const sections: DigestSection[] = [];

	for (const candidate of value.sections) {
		if (!isRecord(candidate)) continue;
		if (typeof candidate.block !== "string") continue;
		if (typeof candidate.title !== "string") continue;
		if (!Array.isArray(candidate.items)) continue;

		const items: DigestItem[] = [];

		for (const row of candidate.items) {
			if (!isRecord(row)) continue;
			if (typeof row.id !== "string" || typeof row.title !== "string") continue;

			items.push({
				id: row.id,
				title: row.title,
				...(typeof row.url === "string" && row.url !== ""
					? { url: row.url }
					: {}),
				...(typeof row.meta === "string" && row.meta !== ""
					? { meta: row.meta }
					: {}),
			});
		}

		sections.push({
			block: candidate.block,
			title: candidate.title,
			provider:
				typeof candidate.provider === "string" ? candidate.provider : "",
			items,
			...(typeof candidate.unavailable === "string" &&
			candidate.unavailable !== ""
				? { unavailable: candidate.unavailable }
				: {}),
		});
	}

	return {
		callId: value.callId,
		title:
			typeof value.title === "string" && value.title !== ""
				? value.title
				: "Daily digest",
		generatedAt: value.generatedAt,
		sections,
	};
}

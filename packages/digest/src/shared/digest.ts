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
import {
	boolean,
	fallback,
	isRecord,
	list,
	nonEmptyString,
	object,
	optional,
	type Reader,
	required,
	string,
} from "dsh-integration-host/shape";

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
	 * Whether the block had more rows than its cap allows.
	 *
	 * A source cannot report a total through the wire contract, so the collector
	 * asks for one row past the cap: a block that answers with that row has more.
	 */
	readonly truncated?: boolean;
	/**
	 * How many rows the block had, present only when it was cut.
	 *
	 * One past the cap is all a block answers with, so this is a lower bound:
	 * "at least this many", never a guess at how many more there are.
	 */
	readonly total?: number;
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
	/** The IANA zone `generatedAt` is read in, as the settings name it. */
	readonly timeZone: string;
	/**
	 * Every block the installed sources offered, and whether it was on.
	 *
	 * An empty digest is a fact about the configuration rather than about the
	 * work: with this list the card and the model can tell "no integration is
	 * connected" from "every block is switched off" and name the next step. It is
	 * absent on a payload recorded by a version that did not report it, and a
	 * card then says nothing rather than guessing which kind of empty it was.
	 */
	readonly offered?: readonly DigestBlockView[];
	readonly sections: readonly DigestSection[];
}

/**
 * What to call a digest with this delivery schedule.
 *
 * "Daily" is a lie for a Monday/Wednesday/Friday digest; the card and the
 * reminder use this one rule.
 */
export const digestTitle = (days: readonly number[] | undefined): string =>
	days?.length === 7 ? "Daily digest" : "Digest";

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

/**
 * The same zone, spelled the way the reminder service stores it.
 *
 * `Intl` accepts a few names the service refuses — `CET`, `GMT`, `EST5EDT` —
 * and resolves each to the canonical zone it actually means. Normalizing on the
 * way out keeps the settings card, the command and the reminder on one spelling.
 * @param value - a zone name the card or a hand-edited file supplied.
 * @returns the canonical IANA name, or undefined when the zone names nothing.
 */
export const canonicalTimeZone = (value: unknown): string | undefined => {
	if (typeof value !== "string" || value === "") return undefined;

	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: value,
		}).resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
};

/**
 * The clock time a reminder is created with.
 *
 * The settings card edits `HH:MM`; the schedule service validates `HH:mm:ss`.
 * The conversion lives here so neither half has to remember the other's format.
 * @param value - a wall-clock time in the card's `HH:MM` form.
 * @returns the same time with seconds, or the input when it was not one.
 */
export const toScheduleTime = (value: string): string =>
	isDigestTime(value) ? `${value}:00` : value;

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
	/**
	 * Why the reminder catalog could not be read, when it could not.
	 *
	 * Present means {@link scheduled} is not "none" but "unknown": the card and
	 * the command say that instead of claiming no session has a digest.
	 */
	readonly remindersError?: string;
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

/**
 * The weekdays in the order a working week reads, Monday first.
 *
 * The stored numbers keep JavaScript's Sunday-first numbering, because that is
 * what a date carries; only the order things are *drawn and printed* in changes.
 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * When one digest was assembled, as both halves spell it.
 *
 * The card and the model's text are two readings of one instant, so the format
 * lives here and names its zone: a reader in another zone than the browser's
 * cannot otherwise tell whether "04:00" is their morning or somebody else's.
 * @param generatedAt - the instant, as the report carries it.
 * @param timeZone - the zone the digest's settings name.
 */
export const digestStamp = (generatedAt: string, timeZone?: string): string => {
	const at = new Date(generatedAt);

	if (Number.isNaN(at.getTime())) return generatedAt;

	const zone = isTimeZone(timeZone) ? timeZone : undefined;
	const text = new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeStyle: "short",
		...(zone === undefined ? {} : { timeZone: zone }),
	}).format(at);

	return zone === undefined ? text : `${text} ${zone}`;
};

/**
 * What an empty digest means, and what to do about it.
 *
 * An empty report is a fact about the configuration, not about the work: no
 * integration has offered a block, every block is switched off, or every one
 * that is on had nothing. The first two have a next step and the third does not,
 * and a card that says "0 rows" leaves the reader to guess which they got.
 * @param offered - every block the installed sources offered, and its switch.
 */
export const emptyDigestNote = (
	offered: readonly DigestBlockView[],
): string => {
	if (offered.length === 0)
		return "No integration is offering digest blocks yet. Connect Jira, GitLab or Sentry on the Integrations page, then run the digest again.";

	const off = offered.filter((block) => !block.on);

	if (off.length === offered.length)
		return `Every block is switched off (${offered.length}). Turn one on in Settings → Digest, or run /digest blocks <id> on.`;

	return "Every block that is on had nothing waiting in the last day.";
};

/** One row of a block. */
const item = object<DigestItem>({
	id: required(string),
	title: required(string),
	url: optional(nonEmptyString),
	meta: optional(nonEmptyString),
});

/** A count that is present only when it is positive. */
const positiveNumber: Reader<number> = (value) =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;

/** One block of the digest. */
const section = object<DigestSection>({
	block: required(string),
	title: required(string),
	provider: fallback(string, ""),
	items: required(list(item)),
	truncated: optional(boolean),
	total: optional(positiveNumber),
	unavailable: optional(nonEmptyString),
});

/** One block the digest could have shown. */
const blockView = object<DigestBlockView>({
	id: required(nonEmptyString),
	title: fallback(string, ""),
	provider: fallback(string, ""),
	on: required(boolean),
});

/** A section without its own items list is not a section. */
const readSection: Reader<DigestSection> = (value) =>
	isRecord(value) && Array.isArray(value.items) ? section(value) : undefined;

/** A title always exists; the default is the card's own heading. */
const title: Reader<string> = (value) => nonEmptyString(value) ?? "Digest";

const report = object<DigestReport>({
	callId: required(nonEmptyString),
	title: required(title),
	generatedAt: required(string),
	timeZone: fallback(string, ""),
	offered: optional(list(blockView)),
	sections: required(list(readSection)),
});

/**
 * Narrow one opaque record payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the report, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool keeps a text
 *   result as the source of truth for the model.
 */
export function asDigestReport(value: unknown): DigestReport | undefined {
	if (!isRecord(value) || !Array.isArray(value.sections)) return undefined;

	return report(value);
}

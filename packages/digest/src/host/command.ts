/**
 * The `/digest` slash command.
 *
 * A command runs against the agent without creating a model message, which is
 * what makes it the right place to bind a reminder: the reminder belongs to the
 * session the human is in, and this is the only surface that knows which one
 * that is. The settings card can say *what* and *when*; only `/digest on` can
 * say *where*.
 *
 * Everything it writes goes to the same settings document the card writes, so
 * the two entrances can never disagree about what the user chose. And everything
 * it prints about the reminders is read from the service each time, so a user
 * who forgot where they enabled the digest can find those sessions — and stop
 * them — from one place.
 */

import type { CommandResult } from "dsh-integration-host";
import {
	DAY_LABELS,
	type DigestSettings,
	isDigestTime,
	isTimeZone,
	WEEK_ORDER,
} from "../shared/digest";
import type { DigestCollector } from "./collect";
import type { DigestSave } from "./save";
import type { DigestReminders, DigestSchedule } from "./schedule";
import type { DigestSettingsStore } from "./settings";

/** The weekdays this command understands, by the names a human types. */
const WEEKDAYS: Readonly<Record<string, number>> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

/** Every action this command has, as the refusal message lists them. */
const ACTIONS = [
	"status",
	"now",
	"on",
	"off [all]",
	"time HH:MM",
	"timezone <IANA zone>",
	"days mon,tue,...",
	"blocks [<id> on|off]",
] as const;

/** What the command needs from the plugin. */
export interface DigestCommandDeps {
	readonly collector: DigestCollector;
	readonly settings: DigestSettingsStore;
	readonly schedule: DigestSchedule;
	readonly save: DigestSave;
}

/** The invoking agent, as the command registry hands it over. */
interface Invocation {
	readonly rawInput?: unknown;
	readonly agent?: {
		readonly id?: string;
		readonly session?: { readonly id?: string };
	};
}

/**
 * The session a reminder should be bound to.
 *
 * The harness's `Agent` declares an id and, at runtime, carries the session it
 * runs; either names the same session, and an agent that has neither cannot be
 * scheduled against.
 */
const sessionOf = (agent: Invocation["agent"]): string | undefined =>
	agent?.session?.id ?? agent?.id;

/**
 * Parse a comma-separated list of weekday names.
 * @param input - such as `mon,tue,wed`.
 * @returns the JS weekday numbers, or undefined when any name is unknown.
 */
export const parseDays = (input: string): number[] | undefined => {
	const names = input
		.split(/[\s,]+/u)
		.map((name) => name.trim().slice(0, 3).toLowerCase())
		.filter((name) => name !== "");

	if (names.length === 0) return undefined;

	const days = names.map((name) => WEEKDAYS[name]);

	if (days.some((day) => day === undefined)) return undefined;

	return [...new Set(days as number[])].sort((left, right) => left - right);
};

/**
 * The days of one configuration, as a human reads them.
 *
 * Monday first: the stored numbers keep JavaScript's Sunday-first order, but a
 * working week read out of order — "Sun, Mon, Tue" — is a small lie about how
 * people plan one.
 */
export const describeDays = (days: readonly number[]): string =>
	days.length === 7
		? "every day"
		: WEEK_ORDER.filter((day) => days.includes(day))
				.map((day) => DAY_LABELS[day] ?? String(day))
				.join(", ");

/** The refusal for an action this command does not have. */
const unknownAction = (action: string): CommandResult => ({
	kind: "error",
	text: `"/digest ${action}" is not an action. Use /digest ${ACTIONS.join(" | ")}.`,
});

/**
 * Build the handler the command registers.
 * @param deps - the collector, the settings, and the reminder binding.
 */
export const createDigestCommand =
	(deps: DigestCommandDeps) =>
	async (invocation: Invocation): Promise<CommandResult> => {
		const words = String(invocation.rawInput ?? "")
			.trim()
			.split(/\s+/u)
			.filter((word) => word !== "");
		const [action = "status", ...rest] = words;
		const current = await deps.settings.ensure();

		try {
			if (action === "now") {
				const collected = await deps.collector.collect(
					`digest-command-${Date.now()}`,
					new Date(),
				);

				return { kind: "success", text: collected.summary };
			}

			if (action === "on" || action === "off") {
				if (!deps.schedule.isAvailable)
					return {
						kind: "error",
						text: "This harness composes no reminder service, so a digest cannot be scheduled.",
					};

				if (action === "off" && rest[0] === "all") {
					const removed = await deps.schedule.unbindAll();

					return {
						kind: "success",
						text:
							removed === 0
								? "No digest was scheduled in any session."
								: `The digest is no longer scheduled anywhere (${removed} reminder${removed === 1 ? "" : "s"} removed).`,
					};
				}

				const sessionId = sessionOf(invocation.agent);

				if (sessionId === undefined)
					return {
						kind: "error",
						text: "This command cannot tell which session to bind the digest to.",
					};

				if (action === "off") {
					const removed = await deps.schedule.unbind(sessionId);

					return {
						kind: "success",
						text:
							removed === 0
								? "No digest was scheduled for this session."
								: "The digest is no longer scheduled for this session.",
					};
				}

				await deps.schedule.bind(sessionId, current);

				return {
					kind: "success",
					text: `The digest will arrive in this session at ${current.time} ${current.timeZone}, ${describeDays(current.days)}.`,
				};
			}

			if (action === "time") {
				const time = rest[0] ?? "";

				if (!isDigestTime(time))
					return {
						kind: "error",
						text: "Use /digest time HH:MM, in 24-hour form.",
					};

				const saved = await deps.save.apply({ time });

				return {
					kind: "success",
					text: `The digest is set for ${saved.time} ${saved.timeZone}.`,
				};
			}

			if (action === "timezone") {
				const timeZone = rest[0] ?? "";

				if (!isTimeZone(timeZone))
					return {
						kind: "error",
						text: `"${timeZone}" is not an IANA time zone, such as Europe/Moscow.`,
					};

				const saved = await deps.save.apply({ timeZone });

				return {
					kind: "success",
					text: `The digest is set for ${saved.time} ${saved.timeZone}.`,
				};
			}

			if (action === "days") {
				const days = parseDays(rest.join(" "));

				if (days === undefined)
					return {
						kind: "error",
						text: "Name weekdays, separated by commas: /digest days mon,tue,wed,thu,fri.",
					};

				await deps.save.apply({ days });

				return {
					kind: "success",
					text: `The digest will arrive ${describeDays(days)}.`,
				};
			}

			if (action === "blocks") return await blocks(deps, rest, current);

			if (action === "status")
				return { kind: "success", text: await status(deps, current) };

			return unknownAction(action);
		} catch (error) {
			return {
				kind: "error",
				text: error instanceof Error ? error.message : String(error),
			};
		}
	};

/** The block switches: list them, or turn one on or off. */
async function blocks(
	deps: DigestCommandDeps,
	rest: readonly string[],
	current: DigestSettings,
): Promise<CommandResult> {
	const sources = deps.collector.sources();
	const [id, value] = rest;

	if (id === undefined)
		return {
			kind: "success",
			text:
				sources.length === 0
					? "No integrations are offering digest blocks."
					: sources
							.map(
								(block) =>
									`${(current.blocks[block.id] ?? block.defaultOn) ? "on " : "off"} ${block.id} — ${block.title} (${block.provider})`,
							)
							.join("\n"),
		};

	if (
		!sources.some((block) => block.id === id) ||
		!["on", "off"].includes(value ?? "")
	)
		return {
			kind: "error",
			text: `Use /digest blocks <${sources.map((block) => block.id).join("|") || "block"}> on|off.`,
		};

	const saved = await deps.save.apply({
		blocks: { ...current.blocks, [id]: value === "on" },
	});

	return {
		kind: "success",
		text: `${id} is ${(saved.blocks[id] ?? false) ? "on" : "off"}.`,
	};
}

/** One bound session, as the status line lists it. */
const sessionLine = (sessionId: string): string => `- ${sessionId}`;

/** The line a bare `/digest` answers with. */
async function status(
	deps: DigestCommandDeps,
	current: DigestSettings,
): Promise<string> {
	const reminders = await deps.schedule.bound();
	const lines = [
		`Digest: ${current.time} ${current.timeZone}, ${describeDays(current.days)}, up to ${current.limit} rows per block.`,
	];

	lines.push(remindersLine(deps, reminders));

	if (reminders.entries.length > 0)
		lines.push(
			...reminders.entries.map((entry) => sessionLine(entry.sessionId)),
			"`/digest off` stops the reminder for this session; `/digest off all` stops every one.",
		);

	return lines.join("\n");
}

/** How many sessions receive the digest — or why that is not known. */
const remindersLine = (
	deps: DigestCommandDeps,
	reminders: DigestReminders,
): string => {
	if (!deps.schedule.isAvailable)
		return "This harness composes no reminder service.";

	if (reminders.error !== undefined)
		return `The reminder catalog could not be read (${reminders.error}), so how many sessions receive the digest is unknown.`;

	if (reminders.entries.length === 0)
		return "Scheduled in no session yet — run /digest on where you want it.";

	return `Scheduled in ${reminders.entries.length} session${reminders.entries.length === 1 ? "" : "s"}:`;
};

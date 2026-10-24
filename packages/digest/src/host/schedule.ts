/**
 * The reminder service, as this plugin uses it.
 *
 * A reminder belongs to a session: the harness stores it against the session
 * that asked for it and delivers it there. That is the right shape for a digest
 * — it arrives where the work is, and a week away produces one digest rather
 * than five — but it also means the digest plugin cannot create one from a
 * settings page, which has no session. So the settings card owns *what* and
 * *when*, and `/digest on` owns *where*.
 *
 * The service is composed by the deployment rather than by this plugin, so it
 * is read at the moment it is used and its absence is an answer, not a failure:
 * a harness without it simply cannot schedule, and says so.
 *
 * The declarations below are the narrow slice of `@deepseek-ai/dsh-schedule`
 * this plugin calls. They are not installed here — the plugin is built against
 * the harness it runs in — so the shapes are written out and verified against
 * the shipped service.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	canonicalTimeZone,
	type DigestSettings,
	toScheduleTime,
} from "../shared/digest";

/** The line every digest reminder's prompt starts with, so it is recognisable. */
export const PROMPT_MARKER = "[dsh-digest]";

/** The title every digest reminder carries, as the harness UI shows it. */
export const TASK_TITLE = "Work digest";

/** What a digest reminder tells the model when it fires. */
export const TASK_PROMPT = `${PROMPT_MARKER} Assemble today's digest with the digest tool and present it. This is a read-only run: do not write to any external system.`;

/** A wall-clock time in one zone, as the schedule service takes it. */
export interface ScheduleClock {
	readonly time: string;
	readonly time_zone: string;
}

/** One recurring rule, in the service's own vocabulary. */
export interface ScheduleCreateRequest {
	readonly prompt: string;
	readonly title: string;
	readonly daily?: ScheduleClock;
	readonly weekly?: ScheduleClock & { readonly weekdays: readonly number[] };
}

/** One stored reminder. */
export interface ScheduleRecord {
	readonly id: string;
	readonly title: string;
	/** The instruction delivered when it fires; the digest's own marker lives here. */
	readonly prompt?: string;
}

/** One stored reminder with the session it belongs to. */
export interface ScheduleCatalogEntry extends ScheduleRecord {
	readonly sessionId: string;
	readonly status: "active" | "inactive";
}

/** The slice of the harness schedule service this plugin calls. */
export interface ScheduleService {
	create(
		sessionId: string,
		request: ScheduleCreateRequest,
		signal?: AbortSignal,
	): Promise<ScheduleRecord>;
	catalog(): Promise<readonly ScheduleCatalogEntry[]>;
	delete(request: { sessionId: string; id: string }): Promise<unknown>;
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		/** The harness reminder service; absent in a deployment that composes none. */
		schedule: ScheduleService;
	}
}

/** The recurrence a digest configuration asks for. */
export interface DigestTiming {
	readonly daily?: ScheduleClock;
	readonly weekly?: ScheduleClock & { readonly weekdays: readonly number[] };
}

/** JS weekday numbers (0 = Sunday) to the ISO numbers the service validates. */
const isoDay = (day: number): number => (day === 0 ? 7 : day);

/**
 * Turn the chosen days into a recurrence the schedule service accepts.
 *
 * The service has two recurring rules and neither is "these days of the week
 * except all of them": a seven-day digest is daily, anything narrower is
 * weekly. Choosing between them here keeps that distinction in one place.
 * @param settings - the time, zone and days in force.
 */
export const timingOf = (settings: DigestSettings): DigestTiming => {
	const clock: ScheduleClock = {
		time: toScheduleTime(settings.time),
		time_zone: canonicalTimeZone(settings.timeZone) ?? "UTC",
	};
	const everyDay = [0, 1, 2, 3, 4, 5, 6].every((day) =>
		settings.days.includes(day),
	);

	if (everyDay) return { daily: clock };

	return {
		weekly: {
			...clock,
			weekdays: [...settings.days]
				.sort((left, right) => left - right)
				.map(isoDay),
		},
	};
};

/** Whether one stored reminder is this plugin's. */
export const isDigestReminder = (record: ScheduleRecord): boolean =>
	record.prompt?.startsWith(PROMPT_MARKER) === true;

/**
 * The digest's reminders, as one object that owns reading and replacing them.
 *
 * Every mutation goes through the same two steps — drop this session's existing
 * digest reminder, then create the current one — so a change of time can never
 * leave two reminders racing to deliver the same digest.
 */
export class DigestSchedule {
	constructor(private readonly ctx: Context) {}

	/** The service, when the deployment composes one. */
	private get service(): ScheduleService | undefined {
		return this.ctx.get("schedule");
	}

	/** Whether this deployment can schedule at all. */
	get isAvailable(): boolean {
		return this.service !== undefined;
	}

	/**
	 * Every digest reminder, across every session.
	 *
	 * A failing catalog read answers "none" rather than failing the caller: this
	 * is asked while drawing a settings card, and a card that cannot say how many
	 * reminders exist is better than one that cannot be drawn.
	 */
	async bound(): Promise<readonly ScheduleCatalogEntry[]> {
		try {
			return await this.entries();
		} catch {
			return [];
		}
	}

	/** The digest reminders, with a failing catalog reported to the caller. */
	private async entries(): Promise<readonly ScheduleCatalogEntry[]> {
		const entries = (await this.service?.catalog()) ?? [];

		return entries.filter((entry) => isDigestReminder(entry));
	}

	/**
	 * Create this session's digest reminder, replacing any it already has.
	 * @param sessionId - the session that should receive the digest.
	 * @param settings - the time, zone and days in force.
	 * @returns whether a reminder is now bound.
	 */
	async bind(sessionId: string, settings: DigestSettings): Promise<boolean> {
		const service = this.service;

		if (service === undefined) return false;

		// A failed catalog must not turn into "this session has no reminder": that
		// would create a second one and deliver the digest twice.
		const mine = (await this.entries()).filter(
			(entry) => entry.sessionId === sessionId,
		);

		const created = await service.create(sessionId, {
			prompt: TASK_PROMPT,
			title: TASK_TITLE,
			...timingOf(settings),
		});

		// Create first: a failed create leaves the old reminder in place. If a
		// delete then fails, the new reminder goes back so the session is not left
		// with two digests a day.
		try {
			for (const entry of mine)
				await service.delete({ sessionId, id: entry.id });
		} catch (error) {
			await service.delete({ sessionId, id: created.id });

			throw error;
		}

		return true;
	}

	/**
	 * Drop this session's digest reminder, if it has one.
	 * @returns how many reminders were removed.
	 */
	async unbind(sessionId: string): Promise<number> {
		const service = this.service;

		if (service === undefined) return 0;

		const mine = (await this.entries()).filter(
			(entry) => entry.sessionId === sessionId,
		);

		for (const entry of mine) await service.delete({ sessionId, id: entry.id });

		return mine.length;
	}

	/**
	 * Re-time every bound reminder, wherever it lives.
	 *
	 * Changing the time in the settings card has to reach reminders created by
	 * other sessions, or the card would be editing a value that only the next
	 * `/digest on` ever reads.
	 * @param settings - the time, zone and days now in force.
	 * @returns how many reminders were re-created.
	 */
	async rebindAll(settings: DigestSettings): Promise<number> {
		const service = this.service;

		if (service === undefined) return 0;

		const mine = await this.bound();

		for (const entry of mine) {
			const created = await service.create(entry.sessionId, {
				prompt: TASK_PROMPT,
				title: TASK_TITLE,
				...timingOf(settings),
			});

			try {
				await service.delete({ sessionId: entry.sessionId, id: entry.id });
			} catch (error) {
				await service.delete({ sessionId: entry.sessionId, id: created.id });

				throw error;
			}
		}

		return mine.length;
	}
}

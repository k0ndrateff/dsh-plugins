/**
 * The reminders: what a configuration turns into, and what a change does to
 * the reminders that already exist.
 *
 *   bun run test/schedule.ts
 *
 * The schedule service belongs to the harness and is not installed here, so it
 * is faked — but only at the seam the plugin actually uses, which is the point:
 * the plugin never touches the service's storage, only its three calls.
 */

import { test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import { check } from "../../../test/support";
import {
	DigestSchedule,
	isDigestReminder,
	PROMPT_MARKER,
	type ScheduleCatalogEntry,
	type ScheduleCreateRequest,
} from "../src/host/schedule";
import { defaultDigestSettings } from "../src/host/settings";
import { canonicalTimeZone, toScheduleTime } from "../src/shared/digest";

/** One reminder the fake service holds. */
interface Held {
	readonly sessionId: string;
	readonly id: string;
	readonly request: ScheduleCreateRequest;
}

/** A schedule service that remembers what it was asked to do. */
class FakeSchedule {
	readonly held: Held[] = [];
	readonly deleted: string[] = [];
	private next = 1;

	async create(
		sessionId: string,
		request: ScheduleCreateRequest,
	): Promise<{ id: string }> {
		const time = request.daily?.time ?? request.weekly?.time;

		// The shipped service validates this exact shape; a fake that accepts
		// anything is what let a plain HH:MM reach production.
		if (time !== undefined && !/^\d{2}:\d{2}:\d{2}$/u.test(time))
			throw new Error(`the service refuses the clock time "${time}"`);

		const id = `task-${this.next}`;
		this.next += 1;
		this.held.push({ sessionId, id, request });

		return { id };
	}

	async catalog(): Promise<readonly ScheduleCatalogEntry[]> {
		return this.held.map((entry) => ({
			id: entry.id,
			title: entry.request.title,
			prompt: entry.request.prompt,
			sessionId: entry.sessionId,
			status: "active" as const,
		}));
	}

	async delete(request: { sessionId: string; id: string }): Promise<void> {
		this.deleted.push(request.id);

		const index = this.held.findIndex((entry) => entry.id === request.id);

		if (index >= 0) this.held.splice(index, 1);
	}
}

/** A context whose only service is the fake schedule, when one is given. */
const contextWith = (schedule: FakeSchedule | undefined): Context =>
	({
		get: (name: string) => (name === "schedule" ? schedule : undefined),
	}) as unknown as Context;

test("the clock the service stores", async () => {
	check(
		"a card time gains seconds",
		toScheduleTime("09:00") === "09:00:00",
		toScheduleTime("09:00"),
	);
	check(
		"a short zone name resolves to a usable one",
		typeof canonicalTimeZone("GMT") === "string" &&
			canonicalTimeZone("GMT") !== "",
		String(canonicalTimeZone("GMT")),
	);
});
test("a configuration becomes a recurrence", async () => {
	{
		const settings = defaultDigestSettings();
		const everyDay = new DigestSchedule(contextWith(undefined));

		check(
			"seven days is a daily rule, with the service's own snake case",
			JSON.stringify(
				(await import("../src/host/schedule")).timingOf({
					...settings,
					days: [0, 1, 2, 3, 4, 5, 6],
				}),
			) ===
				JSON.stringify({
					daily: { time: `${settings.time}:00`, time_zone: settings.timeZone },
				}),
		);

		const { timingOf } = await import("../src/host/schedule");
		const weekdays = timingOf({ ...settings, days: [5, 1, 3] });

		check(
			"a narrower week is a weekly rule, sorted and in ISO numbering",
			JSON.stringify(weekdays) ===
				JSON.stringify({
					weekly: {
						time: `${settings.time}:00`,
						time_zone: settings.timeZone,
						weekdays: [1, 3, 5],
					},
				}),
			JSON.stringify(weekdays),
		);

		check(
			"Sunday becomes ISO 7, not 0",
			JSON.stringify(timingOf({ ...settings, days: [0] }).weekly?.weekdays) ===
				"[7]",
		);
		void everyDay;
	}
});
test("what counts as this plugin's reminder", async () => {
	check(
		"our own prompt is ours",
		isDigestReminder({ id: "1", title: "x", prompt: `${PROMPT_MARKER} go` }),
	);
	check(
		"a task with our title but a foreign prompt is not ours",
		!isDigestReminder({
			id: "1",
			title: "Daily work digest",
			prompt: "water the plants",
		}),
	);
	check(
		"a task with no prompt is not ours",
		!isDigestReminder({ id: "1", title: "Daily work digest" }),
	);
});
test("binding to a session", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));
		const settings = defaultDigestSettings();

		check(
			"a deployment with no service says so",
			!new DigestSchedule(contextWith(undefined)).isAvailable,
		);

		check("binding succeeds", await schedule.bind("session-a", settings));
		check("one reminder exists", service.held.length === 1);
		check(
			"it is bound to the asking session",
			service.held[0]?.sessionId === "session-a",
		);
		check(
			"it carries our marker",
			isDigestReminder({
				...(service.held[0]?.request ?? { prompt: "", title: "" }),
				id: "x",
				title: "t",
			}),
		);

		await schedule.bind("session-a", { ...settings, time: "07:00" });

		check(
			"re-binding replaces rather than duplicates",
			service.held.length === 1 &&
				(service.held[0]?.request.daily?.time ??
					service.held[0]?.request.weekly?.time) === "07:00:00",
			JSON.stringify(
				service.held.map(
					(entry) => entry.request.daily?.time ?? entry.request.weekly?.time,
				),
			),
		);

		await schedule.bind("session-b", settings);

		check("another session gets its own", service.held.length === 2);

		check(
			"unbinding one leaves the other",
			(await schedule.unbind("session-a")) === 1,
		);
		check(
			"and it is the right one that went",
			service.held.length === 1 && service.held[0]?.sessionId === "session-b",
		);

		check(
			"unbinding an empty session removes nothing",
			(await schedule.unbind("session-c")) === 0,
		);
	}
});
test("re-timing every bound reminder", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));
		const settings = defaultDigestSettings();

		await schedule.bind("session-a", settings);
		await schedule.bind("session-b", settings);

		const rebound = await schedule.rebindAll({
			...settings,
			time: "06:30",
			days: [1, 2, 3, 4, 5],
		});

		check("every reminder was re-created", rebound === 2);
		check(
			"each kept its own session",
			service.held
				.map((entry) => entry.sessionId)
				.sort()
				.join(",") === "session-a,session-b",
			service.held.map((entry) => entry.sessionId).join(","),
		);
		check(
			"and carries the new rule",
			service.held.every(
				(entry) =>
					entry.request.weekly?.time === "06:30:00" &&
					entry.request.weekly?.weekdays.join(",") === "1,2,3,4,5",
			),
			JSON.stringify(service.held.map((entry) => entry.request.weekly)),
		);
	}
});
test("a deployment without the service", async () => {
	{
		const schedule = new DigestSchedule(contextWith(undefined));
		const settings = defaultDigestSettings();

		check("nothing is bound", !(await schedule.bind("session-a", settings)));
		check("nothing is counted", (await schedule.bound()).length === 0);
		check("re-timing is a no-op", (await schedule.rebindAll(settings)) === 0);
		check("unbinding is a no-op", (await schedule.unbind("session-a")) === 0);
	}
});

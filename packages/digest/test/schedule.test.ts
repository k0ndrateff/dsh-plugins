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

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import {
	DigestSchedule,
	isDigestReminder,
	PROMPT_MARKER,
	type ScheduleCatalogEntry,
	type ScheduleCreateRequest,
	TASK_PROMPT,
} from "../src/host/schedule";
import { defaultDigestSettings } from "../src/host/settings";
import {
	canonicalTimeZone,
	digestTitle,
	toScheduleTime,
} from "../src/shared/digest";

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
	/** Whether the next catalog read answers the way a broken service does. */
	failCatalog = false;
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
		if (this.failCatalog) throw new Error("the reminder catalog is locked");

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
	expect(
		toScheduleTime("09:00") === "09:00:00",
		`a card time gains seconds — ${toScheduleTime("09:00")}`,
	).toBe(true);
	expect(
		typeof canonicalTimeZone("GMT") === "string" &&
			canonicalTimeZone("GMT") !== "",
		`a short zone name resolves to a usable one — ${String(canonicalTimeZone("GMT"))}`,
	).toBe(true);
});
test("a configuration becomes a recurrence", async () => {
	{
		const settings = defaultDigestSettings();
		const everyDay = new DigestSchedule(contextWith(undefined));

		expect(
			JSON.stringify(
				(await import("../src/host/schedule")).timingOf({
					...settings,
					days: [0, 1, 2, 3, 4, 5, 6],
				}),
			) ===
				JSON.stringify({
					daily: { time: `${settings.time}:00`, time_zone: settings.timeZone },
				}),
			"seven days is a daily rule, with the service's own snake case",
		).toBe(true);

		const { timingOf } = await import("../src/host/schedule");
		const weekdays = timingOf({ ...settings, days: [5, 1, 3] });

		expect(
			JSON.stringify(weekdays) ===
				JSON.stringify({
					weekly: {
						time: `${settings.time}:00`,
						time_zone: settings.timeZone,
						weekdays: [1, 3, 5],
					},
				}),
			`a narrower week is a weekly rule, sorted and in ISO numbering — ${JSON.stringify(weekdays)}`,
		).toBe(true);

		expect(
			JSON.stringify(timingOf({ ...settings, days: [0] }).weekly?.weekdays) ===
				"[7]",
			"Sunday becomes ISO 7, not 0",
		).toBe(true);
		void everyDay;
	}
});
test("a weekly schedule is not called daily", async () => {
	expect(
		digestTitle([1, 2, 3, 4, 5]) === "Digest" &&
			digestTitle([1, 2, 3, 4, 5, 6, 0]) === "Daily digest",
	).toBe(true);
});
test("what counts as this plugin's reminder", async () => {
	expect(
		isDigestReminder({ id: "1", title: "x", prompt: `${PROMPT_MARKER} go` }),
		"our own prompt is ours",
	).toBe(true);
	expect(
		!isDigestReminder({
			id: "1",
			title: "Daily work digest",
			prompt: "water the plants",
		}),
		"a task with our title but a foreign prompt is not ours",
	).toBe(true);
	expect(
		!isDigestReminder({ id: "1", title: "Daily work digest" }),
		"a task with no prompt is not ours",
	).toBe(true);
});
test("binding to a session", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));
		const settings = defaultDigestSettings();

		expect(
			!new DigestSchedule(contextWith(undefined)).isAvailable,
			"a deployment with no service says so",
		).toBe(true);

		expect(await schedule.bind("session-a", settings), "binding succeeds").toBe(
			true,
		);
		expect(service.held.length === 1, "one reminder exists").toBe(true);
		expect(
			service.held[0]?.sessionId === "session-a",
			"it is bound to the asking session",
		).toBe(true);
		expect(
			isDigestReminder({
				...(service.held[0]?.request ?? { prompt: "", title: "" }),
				id: "x",
				title: "t",
			}),
			"it carries our marker",
		).toBe(true);

		await schedule.bind("session-a", { ...settings, time: "07:00" });

		expect(
			service.held.length === 1 &&
				(service.held[0]?.request.daily?.time ??
					service.held[0]?.request.weekly?.time) === "07:00:00",
			`re-binding replaces rather than duplicates — ${JSON.stringify(
				service.held.map(
					(entry) => entry.request.daily?.time ?? entry.request.weekly?.time,
				),
			)}`,
		).toBe(true);

		await schedule.bind("session-b", settings);

		expect(service.held.length === 2, "another session gets its own").toBe(
			true,
		);

		expect(
			(await schedule.unbind("session-a")) === 1,
			"unbinding one leaves the other",
		).toBe(true);
		expect(
			service.held.length === 1 && service.held[0]?.sessionId === "session-b",
			"and it is the right one that went",
		).toBe(true);

		expect(
			(await schedule.unbind("session-c")) === 0,
			"unbinding an empty session removes nothing",
		).toBe(true);
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

		expect(rebound === 2, "every reminder was re-created").toBe(true);
		expect(
			service.held
				.map((entry) => entry.sessionId)
				.sort()
				.join(",") === "session-a,session-b",
			`each kept its own session — ${service.held.map((entry) => entry.sessionId).join(",")}`,
		).toBe(true);
		expect(
			service.held.every(
				(entry) =>
					entry.request.weekly?.time === "06:30:00" &&
					entry.request.weekly?.weekdays.join(",") === "1,2,3,4,5",
			),
			`and carries the new rule — ${JSON.stringify(service.held.map((entry) => entry.request.weekly))}`,
		).toBe(true);
	}
});
test("a deployment without the service", async () => {
	{
		const schedule = new DigestSchedule(contextWith(undefined));
		const settings = defaultDigestSettings();

		expect(
			!(await schedule.bind("session-a", settings)),
			"nothing is bound",
		).toBe(true);
		expect(
			(await schedule.bound()).entries.length === 0,
			"nothing is counted",
		).toBe(true);
		expect(
			(await schedule.rebindAll(settings)) === 0,
			"re-timing is a no-op",
		).toBe(true);
		expect(
			(await schedule.unbind("session-a")) === 0,
			"unbinding is a no-op",
		).toBe(true);
	}
});

test("a catalog nobody can read is not an empty one", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));

		service.failCatalog = true;

		const read = await schedule.bound();

		expect(
			read.entries.length === 0 && read.error?.includes("catalog is locked"),
			`the read says it failed rather than that nobody has a digest — ${JSON.stringify(read)}`,
		).toBe(true);

		const message = await schedule.rebindAll(defaultDigestSettings()).then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

		expect(
			message.includes("catalog is locked"),
			`a re-time refuses instead of quietly re-timing nothing — ${message}`,
		).toBe(true);
	}
});
test("stopping every reminder at once", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));
		const settings = defaultDigestSettings();

		await schedule.bind("session-a", settings);
		await schedule.bind("session-b", settings);
		await schedule.bind("session-c", settings);

		const removed = await schedule.unbindAll();

		expect(
			removed === 3 && service.held.length === 0,
			`every session's reminder is dropped — ${removed}`,
		).toBe(true);
		expect(
			(await schedule.unbindAll()) === 0,
			"and doing it again removes nothing",
		).toBe(true);
	}
});
test("a failure part-way through stopping them all says how far it got", async () => {
	{
		const service = new FakeSchedule();
		const schedule = new DigestSchedule(contextWith(service));
		const settings = defaultDigestSettings();

		await schedule.bind("session-a", settings);
		await schedule.bind("session-b", settings);

		const original = service.delete.bind(service);
		service.delete = async (request) => {
			await original(request);

			throw new Error("the reminder service went away");
		};

		const message = await schedule.unbindAll().then(
			() => "",
			(error: unknown) => (error as Error).message,
		);

		expect(
			message.includes("stopped 0 of 2") && message.includes("went away"),
			`the refusal counts what it managed before failing — ${message}`,
		).toBe(true);
	}
});
test("the reminder prompt asks for a digest, not a deliverable", async () => {
	expect(
		TASK_PROMPT.startsWith(PROMPT_MARKER) &&
			!TASK_PROMPT.includes("present") &&
			!TASK_PROMPT.toLowerCase().includes("daily") &&
			TASK_PROMPT.includes("show the result"),
		`the scheduled run cannot be read as "call the present tool", and is not called daily — ${TASK_PROMPT}`,
	).toBe(true);
});

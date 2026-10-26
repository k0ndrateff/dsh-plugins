/**
 * Saving an edit: what happens to the document when the reminders cannot follow.
 *
 *   bun run test/save.ts
 *
 * The write is two steps — the document, then every bound reminder — and the
 * suite is about the second one failing: the file must not be left claiming a
 * time no reminder uses, and the caller must get the reason rather than a
 * success. The schedule service is faked at the seam the plugin uses.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { DigestSave } from "../src/host/save";
import {
	DigestSchedule,
	type ScheduleCreateRequest,
} from "../src/host/schedule";
import { DigestSettingsStore } from "../src/host/settings";

const workdir = await mkdtemp(join(tmpdir(), "dsh-digest-save-"));

afterAll(async () => {
	await rm(workdir, { recursive: true, force: true });
});

/** A reminder the fake service holds. */
interface Held {
	readonly sessionId: string;
	readonly id: string;
	readonly request: ScheduleCreateRequest;
}

/** A schedule service that can be told to fail, in any of its three calls. */
class FakeSchedule {
	readonly held: Held[] = [];
	failCatalog = false;
	failCreate = false;
	private next = 1;

	async create(sessionId: string, request: ScheduleCreateRequest) {
		if (this.failCreate)
			throw new Error("the reminder service refused the write");

		const id = `task-${this.next}`;
		this.next += 1;
		this.held.push({ sessionId, id, request });

		return { id };
	}

	async catalog() {
		if (this.failCatalog)
			throw new Error("the reminder catalog is not readable right now");

		return this.held.map((entry) => ({
			id: entry.id,
			title: entry.request.title,
			prompt: entry.request.prompt,
			sessionId: entry.sessionId,
			status: "active" as const,
		}));
	}

	async delete(request: { sessionId: string; id: string }): Promise<void> {
		const index = this.held.findIndex((entry) => entry.id === request.id);

		if (index >= 0) this.held.splice(index, 1);
	}
}

/** One installation over one settings file and one fake service. */
async function installation(name: string) {
	const file = join(workdir, name, "settings.json");
	const settings = new DigestSettingsStore(file);
	const service = new FakeSchedule();
	const schedule = new DigestSchedule({
		get: (key: string) => (key === "schedule" ? service : undefined),
	} as unknown as Context);
	const save = new DigestSave({ settings, schedule });

	await settings.ensure();

	return { file, service, settings, schedule, save };
}

/** The refusal a save threw, or a note that it did not. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();

		return "";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

test("an edit the reminders can follow is saved", async () => {
	{
		const { file, service, settings, save } = await installation("clean");

		await save.apply({ time: "05:00" });

		expect(settings.get().time === "05:00", "the document holds the edit").toBe(
			true,
		);
		expect(
			(JSON.parse(await readFile(file, "utf8")) as { time?: string }).time ===
				"05:00",
			"and so does the file",
		).toBe(true);

		await save.apply({ days: [1, 2, 3, 4, 5] });

		expect(
			service.held.length === 0,
			"a change with no reminder bound reaches nothing",
		).toBe(true);

		await save.apply({ time: "06:30" });
		expect(
			service.held.length === 0 && settings.get().time === "06:30",
			"and still saves",
		).toBe(true);
	}
});

test("an edit the reminders cannot follow is rolled back", async () => {
	{
		const { file, service, settings, save } = await installation("rollback");

		// Something is bound, so a timing change has a reminder to re-create.
		await save.apply({ time: "05:00" });
		await new DigestSchedule({
			get: (key: string) => (key === "schedule" ? service : undefined),
		} as unknown as Context).bind("session-a", settings.get());

		service.failCatalog = true;

		const message = await refusal(async () => {
			await save.apply({ time: "07:15" });
		});

		expect(
			message.includes("rolled back") && message.includes("reminders"),
			`the failure says the edit was rolled back, and why — ${message}`,
		).toBe(true);
		expect(
			settings.get().time === "05:00",
			`the document keeps the previous time — ${settings.get().time}`,
		).toBe(true);
		expect(
			(JSON.parse(await readFile(file, "utf8")) as { time?: string }).time ===
				"05:00",
			"and the file on disk agrees with it",
		).toBe(true);
	}
});

test("a failed reminder write does not eat a change that never needed one", async () => {
	{
		const { service, settings, save } = await installation("blocks");

		service.failCatalog = true;

		await save.apply({ blocks: { "jira-active": false } });

		expect(
			settings.get().blocks["jira-active"] === false,
			"a switch is not a timing change, so a broken catalog is not its problem",
		).toBe(true);
	}
});

test("a create the service refuses leaves the old settings", async () => {
	{
		const { service, settings, save } = await installation("create");

		await save.apply({ time: "05:00" });
		await new DigestSchedule({
			get: (key: string) => (key === "schedule" ? service : undefined),
		} as unknown as Context).bind("session-a", settings.get());

		service.failCreate = true;

		const message = await refusal(async () => {
			await save.apply({ time: "07:15" });
		});

		expect(
			message.includes("refused the write"),
			`the provider's own words reach the caller — ${message}`,
		).toBe(true);
		expect(
			settings.get().time === "05:00" && service.held.length === 1,
			"the previous settings and the existing reminder are intact",
		).toBe(true);
	}
});

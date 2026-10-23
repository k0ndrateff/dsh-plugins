/**
 * The settings document: what a stored file may contain, what survives it, and
 * what a hand-edited typo costs.
 *
 *   bun run test/settings.ts
 *
 * The rule under test is the whole of the reading side — nothing here is
 * allowed to throw, because the file is not the user's interface and a digest
 * that refuses to start is worse than one running on defaults.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DigestSettingsStore,
	defaultDigestSettings,
	normalizeDigestSettings,
} from "../src/host/settings";
import { isDigestTime, isTimeZone } from "../src/shared/digest";

let workdir = "";

beforeAll(async () => {
	workdir = await mkdtemp(join(tmpdir(), "dsh-digest-"));
});

afterAll(async () => {
	await rm(workdir, { recursive: true, force: true });
});

test("a time and a zone", async () => {
	expect(isDigestTime("09:30"), "accepts a 24-hour time").toBe(true);
	expect(isDigestTime("00:00"), "accepts midnight").toBe(true);
	expect(!isDigestTime("24:00"), "refuses 24:00").toBe(true);
	expect(!isDigestTime("9:30"), "refuses a bare hour").toBe(true);
	expect(!isDigestTime("soon"), "refuses nonsense").toBe(true);
	expect(isTimeZone("Europe/Moscow"), "accepts an IANA zone").toBe(true);
	expect(isTimeZone("UTC"), "accepts UTC").toBe(true);
	expect(!isTimeZone("Mars/Olympus"), "refuses an invented zone").toBe(true);
	expect(!isTimeZone(""), "refuses an empty zone").toBe(true);
});
test("what a stored document may say", async () => {
	{
		const defaults = defaultDigestSettings();

		expect(
			JSON.stringify(normalizeDigestSettings(undefined)) ===
				JSON.stringify(defaults) &&
				JSON.stringify(normalizeDigestSettings("nope")) ===
					JSON.stringify(defaults) &&
				JSON.stringify(normalizeDigestSettings([1, 2])) ===
					JSON.stringify(defaults),
			"anything at all falls back to the defaults",
		).toBe(true);

		const kept = normalizeDigestSettings({
			time: "07:15",
			days: [3, 1, 1, 9, -1, "fri"],
			timeZone: "Europe/Berlin",
			blocks: { "jira-active": false, "gitlab-mine": true, bad: "yes" },
			limit: 25,
		});

		expect(kept.time === "07:15", `keeps a valid time — ${kept.time}`).toBe(
			true,
		);
		expect(
			kept.days.join(",") === "1,3",
			`keeps in-range days once each, in order — ${kept.days.join(",")}`,
		).toBe(true);
		expect(kept.timeZone === "Europe/Berlin", "keeps a valid zone").toBe(true);
		expect(
			kept.blocks["jira-active"] === false &&
				kept.blocks["gitlab-mine"] === true &&
				kept.blocks.bad === undefined,
			`keeps boolean switches and drops the rest — ${JSON.stringify(kept.blocks)}`,
		).toBe(true);
		expect(kept.limit === 25, "keeps a limit the card offers").toBe(true);

		const broken = normalizeDigestSettings({
			time: "25:00",
			days: [],
			timeZone: "Nowhere",
			limit: 7,
		});

		expect(
			broken.time === defaults.time,
			`a bad time falls back — ${broken.time}`,
		).toBe(true);
		expect(
			broken.days.join(",") === defaults.days.join(","),
			`an empty week falls back rather than never delivering — ${broken.days.join(",")}`,
		).toBe(true);
		expect(
			broken.timeZone === defaults.timeZone,
			`a bad zone falls back — ${broken.timeZone}`,
		).toBe(true);
		expect(
			broken.limit === defaults.limit,
			"an unlisted limit falls back",
		).toBe(true);
	}
});
test("the document on disk", async () => {
	{
		const file = join(workdir, "digest", "settings.json");
		const store = new DigestSettingsStore(file);

		expect(
			(await store.ensure()).time === "09:00",
			"a missing file answers the defaults",
		).toBe(true);

		await store.save({ time: "06:45", days: [0, 6], limit: 5 });

		expect((await store.get()).time === "06:45", "the write lands").toBe(true);
		expect(
			JSON.parse(await readFile(file, "utf8")).days.join(",") === "0,6",
			"the document is valid JSON with the chosen fields",
		).toBe(true);

		const reread = new DigestSettingsStore(file);

		expect(
			(await reread.ensure()).limit === 5,
			"a fresh instance reads it back",
		).toBe(true);

		await writeFile(file, "{ not json", "utf8");

		expect(
			(await new DigestSettingsStore(file).ensure()).time === "09:00",
			"a corrupt file falls back instead of throwing",
		).toBe(true);

		await store.save({ time: "06:45" });

		expect(
			(await store.get()).time === "06:45",
			"a save after corruption merges onto the last value held in memory",
		).toBe(true);
	}
});
test("a save after the first read", async () => {
	{
		const file = join(workdir, "settled.json");
		const store = new DigestSettingsStore(file);

		await store.ensure();
		const saved = await store.save({ time: "07:00", limit: 25 });

		expect(saved.time === "07:00", "the save answers what it wrote").toBe(true);
		expect(
			(await store.ensure()).time === "07:00" &&
				(await store.ensure()).limit === 25,
			`a later ensure answers the saved value, not the first read — ${`${(await store.ensure()).time}/${(await store.ensure()).limit}`}`,
		).toBe(true);
	}
});
test("two saves at once", async () => {
	{
		const file = join(workdir, "concurrent.json");
		const store = new DigestSettingsStore(file);

		await Promise.all([
			store.save({ time: "07:00" }),
			store.save({ limit: 25 }),
			store.save({ days: [0, 6] }),
		]);

		const stored = JSON.parse(await readFile(file, "utf8")) as {
			time?: string;
			limit?: number;
			days?: number[];
		};

		expect(
			stored.time === "07:00" &&
				stored.limit === 25 &&
				stored.days?.join(",") === "0,6",
			`each edit survives the others — ${JSON.stringify(stored)}`,
		).toBe(true);
	}
});
test("a save that arrives before any read", async () => {
	{
		const file = join(workdir, "raced.json");

		await new DigestSettingsStore(file).save({ time: "05:00" });

		// The surface that writes first is the one that would have clobbered the
		// document with the defaults, because the read is asynchronous and it
		// never waited for it.
		const writer = new DigestSettingsStore(file);

		await writer.save({ limit: 25 });

		expect(
			writer.get().time === "05:00",
			`the stored value survives — ${writer.get().time}`,
		).toBe(true);
		expect(writer.get().limit === 25, "and the new one is applied").toBe(true);
		expect(
			JSON.parse(await readFile(file, "utf8")).time === "05:00",
			"the document on disk holds both",
		).toBe(true);
	}
});
test("the switches in force", async () => {
	{
		const store = new DigestSettingsStore(join(workdir, "switches.json"));

		await store.save({ blocks: { "jira-active": false } });

		const switches = store.switches([
			{ id: "jira-active", defaultOn: true },
			{ id: "sentry-errors", defaultOn: true },
			{ id: "coderabbit", defaultOn: false },
		]);

		expect(switches["jira-active"] === false, "a saved switch wins").toBe(true);
		expect(
			switches["sentry-errors"] === true,
			"an unsaved block keeps its default",
		).toBe(true);
		expect(
			switches.coderabbit === false,
			"an off-by-default block stays off",
		).toBe(true);
	}
});

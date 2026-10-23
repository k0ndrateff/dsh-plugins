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

import { afterAll, beforeAll, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../../../test/support";
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
	check("accepts a 24-hour time", isDigestTime("09:30"));
	check("accepts midnight", isDigestTime("00:00"));
	check("refuses 24:00", !isDigestTime("24:00"));
	check("refuses a bare hour", !isDigestTime("9:30"));
	check("refuses nonsense", !isDigestTime("soon"));
	check("accepts an IANA zone", isTimeZone("Europe/Moscow"));
	check("accepts UTC", isTimeZone("UTC"));
	check("refuses an invented zone", !isTimeZone("Mars/Olympus"));
	check("refuses an empty zone", !isTimeZone(""));
});
test("what a stored document may say", async () => {
	{
		const defaults = defaultDigestSettings();

		check(
			"anything at all falls back to the defaults",
			JSON.stringify(normalizeDigestSettings(undefined)) ===
				JSON.stringify(defaults) &&
				JSON.stringify(normalizeDigestSettings("nope")) ===
					JSON.stringify(defaults) &&
				JSON.stringify(normalizeDigestSettings([1, 2])) ===
					JSON.stringify(defaults),
		);

		const kept = normalizeDigestSettings({
			time: "07:15",
			days: [3, 1, 1, 9, -1, "fri"],
			timeZone: "Europe/Berlin",
			blocks: { "jira-active": false, "gitlab-mine": true, bad: "yes" },
			limit: 25,
		});

		check("keeps a valid time", kept.time === "07:15", kept.time);
		check(
			"keeps in-range days once each, in order",
			kept.days.join(",") === "1,3",
			kept.days.join(","),
		);
		check("keeps a valid zone", kept.timeZone === "Europe/Berlin");
		check(
			"keeps boolean switches and drops the rest",
			kept.blocks["jira-active"] === false &&
				kept.blocks["gitlab-mine"] === true &&
				kept.blocks.bad === undefined,
			JSON.stringify(kept.blocks),
		);
		check("keeps a limit the card offers", kept.limit === 25);

		const broken = normalizeDigestSettings({
			time: "25:00",
			days: [],
			timeZone: "Nowhere",
			limit: 7,
		});

		check("a bad time falls back", broken.time === defaults.time, broken.time);
		check(
			"an empty week falls back rather than never delivering",
			broken.days.join(",") === defaults.days.join(","),
			broken.days.join(","),
		);
		check(
			"a bad zone falls back",
			broken.timeZone === defaults.timeZone,
			broken.timeZone,
		);
		check("an unlisted limit falls back", broken.limit === defaults.limit);
	}
});
test("the document on disk", async () => {
	{
		const file = join(workdir, "digest", "settings.json");
		const store = new DigestSettingsStore(file);

		check(
			"a missing file answers the defaults",
			(await store.ensure()).time === "09:00",
		);

		await store.save({ time: "06:45", days: [0, 6], limit: 5 });

		check("the write lands", (await store.get()).time === "06:45");
		check(
			"the document is valid JSON with the chosen fields",
			JSON.parse(await readFile(file, "utf8")).days.join(",") === "0,6",
		);

		const reread = new DigestSettingsStore(file);

		check(
			"a fresh instance reads it back",
			(await reread.ensure()).limit === 5,
		);

		await writeFile(file, "{ not json", "utf8");

		check(
			"a corrupt file falls back instead of throwing",
			(await new DigestSettingsStore(file).ensure()).time === "09:00",
		);

		await store.save({ time: "06:45" });

		check(
			"a save after corruption merges onto the last value held in memory",
			(await store.get()).time === "06:45",
		);
	}
});
test("a save after the first read", async () => {
	{
		const file = join(workdir, "settled.json");
		const store = new DigestSettingsStore(file);

		await store.ensure();
		const saved = await store.save({ time: "07:00", limit: 25 });

		check("the save answers what it wrote", saved.time === "07:00");
		check(
			"a later ensure answers the saved value, not the first read",
			(await store.ensure()).time === "07:00" &&
				(await store.ensure()).limit === 25,
			`${(await store.ensure()).time}/${(await store.ensure()).limit}`,
		);
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

		check(
			"each edit survives the others",
			stored.time === "07:00" &&
				stored.limit === 25 &&
				stored.days?.join(",") === "0,6",
			JSON.stringify(stored),
		);
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

		check(
			"the stored value survives",
			writer.get().time === "05:00",
			writer.get().time,
		);
		check("and the new one is applied", writer.get().limit === 25);
		check(
			"the document on disk holds both",
			JSON.parse(await readFile(file, "utf8")).time === "05:00",
		);
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

		check("a saved switch wins", switches["jira-active"] === false);
		check(
			"an unsaved block keeps its default",
			switches["sentry-errors"] === true,
		);
		check("an off-by-default block stays off", switches.coderabbit === false);
	}
});

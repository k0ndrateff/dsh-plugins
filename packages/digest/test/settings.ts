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

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DigestSettingsStore,
	defaultDigestSettings,
	isDigestTime,
	isTimeZone,
	normalizeDigestSettings,
} from "../src/host/settings";
import { check, report, section } from "./harness";

const workdir = await mkdtemp(join(tmpdir(), "dsh-digest-"));

try {
	section("a time and a zone");
	check("accepts a 24-hour time", isDigestTime("09:30"));
	check("accepts midnight", isDigestTime("00:00"));
	check("refuses 24:00", !isDigestTime("24:00"));
	check("refuses a bare hour", !isDigestTime("9:30"));
	check("refuses nonsense", !isDigestTime("soon"));
	check("accepts an IANA zone", isTimeZone("Europe/Moscow"));
	check("accepts UTC", isTimeZone("UTC"));
	check("refuses an invented zone", !isTimeZone("Mars/Olympus"));
	check("refuses an empty zone", !isTimeZone(""));

	section("what a stored document may say");
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

	section("the document on disk");
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

	section("a save that arrives before any read");
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

	section("the switches in force");
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
} finally {
	await rm(workdir, { recursive: true, force: true });
}

report();

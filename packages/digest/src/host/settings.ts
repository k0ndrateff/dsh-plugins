/**
 * Where the digest keeps what the user chose.
 *
 * The digest has no provider account and no credential record to hang its
 * settings on, so they live in one JSON document under the harness home. The
 * document is written whole and replaced by rename, so a crash mid-write leaves
 * the previous settings rather than half a file.
 *
 * Reading is forgiving on purpose: a hand-edited typo, a block whose provider
 * was uninstalled, a time that is not a time — each falls back to its default
 * rather than taking the plugin down. Nothing here throws on bad input, because
 * the file is not the user's interface and a broken digest is worse than a
 * default one.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	DEFAULT_DIGEST_LIMIT,
	DIGEST_LIMITS,
	type DigestSettings,
	isDigestTime,
	isTimeZone,
} from "../shared/digest";

/** The document's file name inside the plugin's own directory. */
const FILE_NAME = "settings.json";

/** How many days a schedule may name before it is nonsense. */
const MAX_DAYS = 7;

/** The zone the process is running in, which is what a local digest means. */
export const localTimeZone = (): string => {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	return isTimeZone(zone) ? zone : "UTC";
};

/** What a user who has never opened the settings gets. */
export const defaultDigestSettings = (): DigestSettings => ({
	time: "09:00",
	days: [1, 2, 3, 4, 5],
	timeZone: localTimeZone(),
	blocks: {},
	limit: DEFAULT_DIGEST_LIMIT,
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turn whatever was stored into settings this plugin can use.
 *
 * Exported because it is the whole of the reading rule, and a rule that only
 * runs against a real home directory is a rule nobody tests.
 * @param value - the parsed document, or anything else that was on disk.
 * @returns settings with every field present and usable.
 */
export function normalizeDigestSettings(value: unknown): DigestSettings {
	const defaults = defaultDigestSettings();
	const record = isRecord(value) ? value : {};
	const blocks: Record<string, boolean> = {};

	if (isRecord(record.blocks)) {
		for (const [id, on] of Object.entries(record.blocks)) {
			if (id !== "" && typeof on === "boolean") blocks[id] = on;
		}
	}

	const days = Array.isArray(record.days)
		? [
				...new Set(
					record.days.filter(
						(day): day is number =>
							typeof day === "number" &&
							Number.isInteger(day) &&
							day >= 0 &&
							day < MAX_DAYS,
					),
				),
			].sort((left, right) => left - right)
		: [...defaults.days];

	const limit = Number(record.limit);

	return {
		time: isDigestTime(record.time) ? record.time : defaults.time,
		// An empty week is not a schedule, so it falls back rather than silently
		// never delivering.
		days: days.length === 0 ? [...defaults.days] : days,
		timeZone: isTimeZone(record.timeZone) ? record.timeZone : defaults.timeZone,
		blocks,
		limit: (DIGEST_LIMITS as readonly number[]).includes(limit)
			? limit
			: defaults.limit,
	};
}

/**
 * The settings document, and the only writer of it.
 *
 * The instance holds the last read value so the tool, the route and the command
 * answer from one copy: three readers of a file that changes under them would
 * otherwise disagree about what the user chose.
 *
 * The read is asynchronous and every surface is asynchronous too, so they all
 * go through {@link ensure}: a route that answered from the defaults because it
 * arrived a millisecond early would show the user settings they do not have —
 * and the first save would then write those defaults over the real file.
 */
export class DigestSettingsStore {
	private current: DigestSettings;
	private loading: Promise<DigestSettings> | undefined;

	constructor(
		private readonly file: string,
		current: DigestSettings = defaultDigestSettings(),
	) {
		this.current = current;
	}

	/** Where the document lives, for a log line or a test. */
	get path(): string {
		return this.file;
	}

	/**
	 * Read the document once, falling back to defaults when it is missing or
	 * broken, and answer from that read afterwards.
	 * @returns the settings now in force.
	 */
	async ensure(): Promise<DigestSettings> {
		this.loading ??= this.read();

		return await this.loading;
	}

	/** The settings in force, without touching the disk. */
	get(): DigestSettings {
		return this.current;
	}

	/**
	 * Merge a partial change into the settings and write the result.
	 * @param patch - any subset of the settings, as the route or the command has it.
	 * @returns the settings now in force.
	 */
	async save(patch: unknown): Promise<DigestSettings> {
		await this.ensure();

		const next = normalizeDigestSettings({
			...this.current,
			...(isRecord(patch) ? patch : {}),
		});

		await mkdir(dirname(this.file), { recursive: true });

		const temporary = `${this.file}.tmp`;

		await writeFile(temporary, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
		await rename(temporary, this.file);

		this.current = next;

		return next;
	}

	/**
	 * The switches in force, given the blocks the installed sources offer.
	 * @param blocks - every block id currently on offer.
	 * @returns one entry per block: its saved switch, or its declared default.
	 */
	switches(
		blocks: readonly { id: string; defaultOn: boolean }[],
	): Readonly<Record<string, boolean>> {
		return Object.fromEntries(
			blocks.map((block) => [
				block.id,
				this.current.blocks[block.id] ?? block.defaultOn,
			]),
		);
	}

	/** The one read of the document, from the disk. */
	private async read(): Promise<DigestSettings> {
		try {
			this.current = normalizeDigestSettings(
				JSON.parse(await readFile(this.file, "utf8")),
			);
		} catch {
			// Absent or unreadable: the defaults are the honest answer, and the
			// first save writes a fresh document.
		}

		return this.current;
	}
}

/** The document's own path under a harness home. */
export const settingsPathIn = (home: string): string =>
	`${home.replace(/\/+$/u, "")}/digest/${FILE_NAME}`;

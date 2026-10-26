/**
 * Writing one settings edit, so the document and the reminders agree.
 *
 * The document is written first and the reminders are re-timed second, and no
 * later save can repair the pair if the second step fails: the settings page
 * would promise 06:30 while the reminders still fire at 09:00. So an edit whose
 * reminders cannot follow is rolled back — the file never claims a time no
 * reminder uses — and the caller answers with the reason, rather than reporting
 * "not saved" over a document that was already changed.
 */

import { errorText } from "dsh-mcp-oauth";
import type { DigestSettings } from "../shared/digest";
import type { DigestSchedule } from "./schedule";
import type { DigestSettingsStore } from "./settings";

/** What a write needs: the document, and the reminders bound to it. */
export interface DigestSaveDeps {
	readonly settings: DigestSettingsStore;
	readonly schedule: DigestSchedule;
}

/** Whether one edit changes when the digest arrives. */
const timingDiffers = (
	before: DigestSettings,
	after: DigestSettings,
): boolean =>
	before.time !== after.time ||
	before.timeZone !== after.timeZone ||
	before.days.length !== after.days.length ||
	before.days.some((day) => !after.days.includes(day));

export class DigestSave {
	constructor(private readonly deps: DigestSaveDeps) {}

	/**
	 * Merge one edit into the document and re-time every reminder it moves.
	 * @param patch - any subset of the settings, as the card or the command has it.
	 * @returns the settings now in force.
	 * @throws when the reminders could not follow the edit; the document is put
	 *   back first and the message says so, so nobody has to guess whether the
	 *   save landed.
	 */
	async apply(patch: unknown): Promise<DigestSettings> {
		const before = await this.deps.settings.ensure();
		let after: DigestSettings;

		try {
			after = await this.deps.settings.save(patch);
		} catch (error) {
			throw new Error(`the settings could not be written: ${errorText(error)}`);
		}

		if (!timingDiffers(before, after)) return after;

		try {
			await this.deps.schedule.rebindAll(after);
		} catch (error) {
			throw new Error(await this.rollback(before, error));
		}

		return after;
	}

	/** Put the previous document back, and say what the failure left behind. */
	private async rollback(
		before: DigestSettings,
		error: unknown,
	): Promise<string> {
		try {
			await this.deps.settings.save(before);
		} catch (restoreError) {
			return `the reminders could not be updated (${errorText(error)}), and the previous settings could not be restored either (${errorText(restoreError)}); check ${this.deps.settings.path} by hand`;
		}

		return `the reminders could not be updated (${errorText(error)}); the change was rolled back`;
	}
}

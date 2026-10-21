/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card reaches the host
 * through the named route `/dsh-digest` with ordinary same-origin requests. The
 * transport — JSON in both directions, `{ error }` turned back into a message —
 * belongs to `dsh-integration-ui`; this is the list of calls the digest makes.
 */

import { createHostRequest } from "dsh-integration-ui";
import type {
	DigestReport,
	DigestSettings,
	DigestSettingsView,
} from "../shared/digest";

const request = createHostRequest("/dsh-digest");

export const digestHostApi = {
	/** Read the settings, the blocks on offer, and how many reminders are bound. */
	read: async (): Promise<DigestSettingsView> => {
		return await request("/settings", "GET");
	},

	/**
	 * Merge one edit into the settings.
	 * @param patch - the fields that changed; anything left out is kept.
	 */
	save: async (patch: Partial<DigestSettings>): Promise<DigestSettingsView> => {
		return await request("/settings", "POST", { settings: patch });
	},

	/** Assemble a digest right now, without scheduling anything. */
	now: async (): Promise<DigestReport> => {
		return await request("/now", "POST");
	},
};

/**
 * Reading one answer from the plugin's own write routes.
 *
 * Close and input answer the same way at the edges — an optional sentence and
 * whether the host refused — so the JSON parsing and the sentence lookup live
 * here rather than twice beside the two callers.
 */

import { isRecord } from "dsh-integration-host/shape";

/** Parse a response body, or nothing when it was not JSON. */
export const parseAnswer = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

/** The sentence inside a host answer, whether it reports success or refusal. */
export const hostWord = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;

	for (const key of ["error", "message"]) {
		const text = value[key];
		if (typeof text === "string" && text !== "") return text;
	}

	return undefined;
};

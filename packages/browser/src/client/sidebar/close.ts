/**
 * Asking the host to close this session's browser.
 *
 * The panel's Close button is the only write the browser half makes, and it goes
 * through the plugin's own close route with the session name. The host answers
 * with its own words, and the panel shows them as they came: what a close did is
 * the host's to report, and a browser this half has not seen closed is not a
 * success it may claim.
 */

import { CLOSE_PATH } from "../../shared/panel";

/** What the host said about a close, and whether it says the close did not happen. */
export interface CloseAnswer {
	/** The host's own words, or the status line when it sent none. */
	readonly text: string;
	/** Whether the host refused, or answered with a failure status. */
	readonly isError: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const parse = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

/** The sentence inside a host answer, whether it reports a success or a refusal. */
const hostWord = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;

	for (const key of ["error", "message"]) {
		const text = value[key];
		if (typeof text === "string" && text !== "") return text;
	}

	return undefined;
};

/** Whether the host's own answer is a refusal, whatever status carried it. */
const isRefusal = (value: unknown): boolean => {
	if (!isRecord(value)) return false;

	return typeof value.error === "string" || value.closed === false;
};

/** What to show when the host answered with no body at all. */
const statusLine = (response: Response): string =>
	`${response.status} ${response.statusText}`.trim();

/**
 * Close one session's browser on the host.
 *
 * A transport failure rejects rather than answering, so the caller can tell
 * "the host said no" from "the host was not reached".
 * @param session - the agent-browser session to close.
 * @returns the host's answer, with whether it reports a failure.
 */
export const closeBrowser = async (session: string): Promise<CloseAnswer> => {
	const response = await fetch(
		`${CLOSE_PATH}?session=${encodeURIComponent(session)}`,
		{ method: "POST", headers: { accept: "application/json" } },
	);

	const body = (await response.text()).trim();
	const parsed = parse(body);

	return {
		text: hostWord(parsed) ?? (body === "" ? statusLine(response) : body),
		isError: !response.ok || isRefusal(parsed),
	};
};

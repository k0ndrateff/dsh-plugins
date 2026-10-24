/**
 * Asking the host to close this session's browser.
 *
 * The panel's Close button is the only write the browser half makes, and it goes
 * through the plugin's own close route with the session name. The host answers
 * with its own words, and the panel shows them as they came: what a close did is
 * the host's to report, and a browser this half has not seen closed is not a
 * success it may claim.
 */

import { isRecord } from "dsh-integration-host/shape";
import {
	CLIENT_REQUEST_HEADER,
	CLIENT_REQUEST_VALUE,
} from "dsh-integration-host/status";
import { CLOSE_PATH } from "../../shared/panel";
import { hostWord, parseAnswer } from "./answer";

/** What the host said about a close, and whether it says the close did not happen. */
export interface CloseAnswer {
	/** The host's own words, or the status line when it sent none. */
	readonly text: string;
	/** Whether the host refused, or answered with a failure status. */
	readonly isError: boolean;
}

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
		{
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				[CLIENT_REQUEST_HEADER]: CLIENT_REQUEST_VALUE,
			},
			body: "{}",
		},
	);

	const body = (await response.text()).trim();
	const parsed = parseAnswer(body);
	const closed =
		isRecord(parsed) && parsed.closed === true
			? "The browser was closed."
			: undefined;

	return {
		text:
			hostWord(parsed) ?? closed ?? (body === "" ? statusLine(response) : body),
		isError: !response.ok || isRefusal(parsed),
	};
};

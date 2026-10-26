/**
 * The page as text, for a reader who cannot see the picture.
 *
 * The panel shows a JPEG of a page, which is exactly the wrong medium for a
 * screen reader: its accessible name names the page and stops there, and
 * `role="application"` takes the keys away from the harness. The same
 * accessibility tree the agent uses is text, so this is the second view of the
 * same page: one request, only when the toggle is on.
 */

import { isRecord } from "dsh-integration-host/shape";
import { textUrl } from "../../shared/panel";

/** What the text view has to show, or the reason it has none. */
export interface PageText {
	readonly text: string;
	/** The address the tree was taken at, when the host knew it. */
	readonly url: string;
	readonly error: string | undefined;
}

/** One answer's own words, when it refused. */
const reasonOf = (value: unknown): string | undefined =>
	isRecord(value) && typeof value.error === "string" && value.error !== ""
		? value.error
		: undefined;

/**
 * Read one session's accessibility tree as text.
 * @param session - the browser session whose page is read.
 */
export const readPageText = async (session: string): Promise<PageText> => {
	const response = await fetch(textUrl(session), {
		headers: { accept: "application/json" },
	});
	const body = (await response.text()).trim();
	let parsed: unknown;

	try {
		parsed = JSON.parse(body) as unknown;
	} catch {
		parsed = undefined;
	}

	if (!response.ok)
		return {
			text: "",
			url: "",
			error:
				reasonOf(parsed) ??
				`The host answered ${response.status} ${response.statusText}.`,
		};

	const record = isRecord(parsed) ? parsed : {};

	return {
		text: typeof record.text === "string" ? record.text : "",
		url: typeof record.url === "string" ? record.url : "",
		error: undefined,
	};
};

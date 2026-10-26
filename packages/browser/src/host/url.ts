/**
 * Which addresses this plugin will put in a browser.
 *
 * `agent-browser open` takes a lot of things — a bare `example.com`, a relative
 * path, whatever the shell would not eat. The model is told to pass an absolute
 * URL, and this is the one place that holds it to that: the CLI's refusal for a
 * half-written address is much less useful than naming the schemes this plugin
 * actually opens.
 */

/** The schemes a page can sensibly be opened under. */
const SCHEMES: readonly string[] = ["http:", "https:", "file:", "data:"];

/** The one address with no scheme that is still a page. */
const BLANK = "about:blank";

/** What one raw address was read as. */
export type BrowserUrlReading =
	| { readonly ok: true; readonly url: string }
	| { readonly ok: false; readonly reason: string };

/**
 * Read the address a model asked for.
 * @param raw - the argument as it came.
 * @returns the address to open, or a sentence saying what is accepted.
 */
export const browserUrlOf = (raw: unknown): BrowserUrlReading => {
	if (typeof raw !== "string" || raw.trim() === "")
		return { ok: false, reason: "browser_open needs a url" };

	const url = raw.trim();

	if (url === BLANK) return { ok: true, url };

	try {
		const parsed = new URL(url);

		if (SCHEMES.includes(parsed.protocol)) return { ok: true, url };
	} catch {
		// A relative path or a half-typed address never parses; the sentence
		// below is the same for both.
	}

	return {
		ok: false,
		reason: `browser_open takes an absolute http, https, file, data or about:blank URL, not "${url}".`,
	};
};

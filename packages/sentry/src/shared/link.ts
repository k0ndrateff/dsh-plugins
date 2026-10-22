/**
 * A link this plugin will put in a page.
 *
 * Sentry's documents are Markdown, and a Markdown link can carry any scheme.
 * Only http(s) is a web address the panel may follow; anything else is shown as
 * text rather than becoming a `javascript:` href in the harness origin.
 */
export const isWebUrl = (value: string | null | undefined): value is string =>
	typeof value === "string" && /^https?:\/\//u.test(value);

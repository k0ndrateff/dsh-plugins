/**
 * The page's own size inside the browser window.
 *
 * Neither the frame's metadata nor the picture answers this. `deviceHeight` is
 * the window the browser was launched in — 720 while the page inside it is 633,
 * because Chrome's own chrome is not part of the picture — and the picture is the
 * page scaled to fit that window's surface, with whatever is left over after the
 * fit sitting beside it (a phone viewport inside a desktop window leaves a strip
 * on the right). Clicks are measured in the page's pixels, so the page is asked
 * for its own size, once per connection and again whenever the viewport changes.
 */

import type { AgentBrowserRunner } from "../runner";

/** The page's own width and height, in its own pixels. */
export interface PageSize {
	readonly width: number;
	readonly height: number;
}

/** The question, asked in the page's own language. */
export const PAGE_SIZE_SCRIPT = "JSON.stringify([innerWidth, innerHeight])";

/** One answer field, when it is a finite positive number. */
const sizeOf = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: undefined;

/**
 * Read `eval`'s answer to the page-size question.
 * @param data - the envelope's `data`, whose `result` is the script's own string.
 * @returns the size, or undefined when the page did not answer with a pair.
 */
export const parsePageSize = (data: unknown): PageSize | undefined => {
	if (data === null || typeof data !== "object" || Array.isArray(data))
		return undefined;

	const result = (data as Record<string, unknown>).result;

	if (typeof result !== "string") return undefined;

	let parsed: unknown;

	try {
		parsed = JSON.parse(result) as unknown;
	} catch {
		return undefined;
	}

	if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;

	const width = sizeOf(parsed[0]);
	const height = sizeOf(parsed[1]);

	return width === undefined || height === undefined
		? undefined
		: { width, height };
};

/**
 * Ask one session's page how big it is.
 * @param runner - the CLI runner.
 * @param options - the session, the directory, and the caller's cancellation.
 * @returns the size, or undefined when the page did not answer.
 */
export const askPageSize = async (
	runner: AgentBrowserRunner,
	options: {
		readonly session: string;
		readonly cwd: string;
		readonly signal: AbortSignal;
	},
): Promise<PageSize | undefined> => {
	const outcome = await runner.run({
		args: ["eval", PAGE_SIZE_SCRIPT],
		session: options.session,
		cwd: options.cwd,
		signal: options.signal,
	});

	return outcome.ok ? parsePageSize(outcome.data) : undefined;
};

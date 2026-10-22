/**
 * Browser configuration.
 *
 * The browser is a local program, not a service with an account: what a profile
 * patch can say about it is which executable to run, how long one command may
 * take, how much of its answer the model may read, and the two switches the CLI
 * itself owns. Unknown or malformed fields fall back to the defaults rather than
 * failing activation, because a typo in a patch should not take a plugin down.
 */

/** Raw shape accepted from the profile patch. */
export interface ConfigInput {
	readonly executable?: unknown;
	readonly timeoutMs?: unknown;
	readonly maxOutputBytes?: unknown;
	readonly headed?: unknown;
	readonly allowedDomains?: unknown;
	readonly streamQuality?: unknown;
	readonly streamMaxWidth?: unknown;
	readonly streamMaxHeight?: unknown;
	readonly streamMaxFps?: unknown;
}

/** Resolved configuration: every field present and of the right type. */
export interface BrowserConfig {
	/** The CLI to run, by name on `PATH` or by absolute path. */
	readonly executable: string;
	/** How long one command may take before it is stopped. */
	readonly timeoutMs: number;
	/** How much of one answer the model may read. */
	readonly maxOutputBytes: number;
	/** Show the browser window instead of running it headless. */
	readonly headed: boolean;
	/** Domain patterns the CLI itself enforces; empty means no restriction. */
	readonly allowedDomains: readonly string[];
	/** JPEG quality of the live view; the CLI's own scale, 0 to 100. */
	readonly streamQuality: number;
	/** The widest frame the live view encodes, in pixels. */
	readonly streamMaxWidth: number;
	/** The tallest frame the live view encodes, in pixels. */
	readonly streamMaxHeight: number;
	/** The most frames per second one panel asks the screencast for. */
	readonly streamMaxFps: number;
}

/** The CLI these tools drive. */
export const DEFAULT_EXECUTABLE = "agent-browser";

/** A browser command may load a page, so it is given a minute, not seconds. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Roughly ten thousand tokens of answer: plenty for a page, bounded for a context. */
export const DEFAULT_MAX_OUTPUT_BYTES = 32_768;

/**
 * The live view's own scale.
 *
 * Measured on a real page at 1280x720: quality 30 capped to 640 wide cost 7.5 KB
 * a frame and looked it — a picture drawn a few hundred pixels wide on a dense
 * screen. Full width at quality 60 costs about 31 KB, which is four times the
 * bytes for a picture that is sharp at the size the panel draws it, and a page
 * that has not moved costs nothing at all: the screencast only encodes on paint.
 *
 * The height cap is a ceiling rather than a shape: a taller viewport is scaled to
 * fit it, and a narrow one is never enlarged.
 */
export const DEFAULT_STREAM_QUALITY = 60;
export const DEFAULT_STREAM_MAX_WIDTH = 1_280;
export const DEFAULT_STREAM_MAX_HEIGHT = 800;

/** A person watching a page does not need a video rate. */
export const DEFAULT_STREAM_MAX_FPS = 8;

/** One whole number inside a range, or the fallback. */
const boundedOf = (
	value: unknown,
	fallback: number,
	low: number,
	high: number,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;

	return Math.min(Math.max(Math.round(value), low), high);
};

/** One non-empty string, or the fallback. */
const stringOf = (value: unknown, fallback: string): string =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;

/** One positive finite number, or the fallback. */
const positiveOf = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;

/** The domain patterns a patch named, ignoring anything that is not one. */
const domainsOf = (value: unknown): readonly string[] =>
	Array.isArray(value)
		? value
				.filter(
					(entry): entry is string =>
						typeof entry === "string" && entry.trim() !== "",
				)
				.map((entry) => entry.trim())
		: [];

/**
 * Normalize whatever the loader passed against the plugin's own defaults.
 * @param input - the fields a profile patch may set.
 */
export const resolveConfig = (input?: ConfigInput): BrowserConfig => ({
	executable: stringOf(input?.executable, DEFAULT_EXECUTABLE),
	timeoutMs: positiveOf(input?.timeoutMs, DEFAULT_TIMEOUT_MS),
	maxOutputBytes: positiveOf(input?.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
	headed: input?.headed === true,
	allowedDomains: domainsOf(input?.allowedDomains),
	streamQuality: boundedOf(
		input?.streamQuality,
		DEFAULT_STREAM_QUALITY,
		1,
		100,
	),
	streamMaxWidth: boundedOf(
		input?.streamMaxWidth,
		DEFAULT_STREAM_MAX_WIDTH,
		64,
		3_840,
	),
	streamMaxHeight: boundedOf(
		input?.streamMaxHeight,
		DEFAULT_STREAM_MAX_HEIGHT,
		64,
		2_160,
	),
	streamMaxFps: boundedOf(input?.streamMaxFps, DEFAULT_STREAM_MAX_FPS, 1, 60),
});

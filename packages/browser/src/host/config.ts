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
}

/** The CLI these tools drive. */
export const DEFAULT_EXECUTABLE = "agent-browser";

/** A browser command may load a page, so it is given a minute, not seconds. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Roughly ten thousand tokens of answer: plenty for a page, bounded for a context. */
export const DEFAULT_MAX_OUTPUT_BYTES = 32_768;

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
});

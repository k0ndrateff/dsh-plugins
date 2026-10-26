/**
 * Browser configuration.
 *
 * The browser is a local program, not a service with an account: what a profile
 * patch can say about it is which executable to run, how long one command may
 * take, how much of its answer the model may read, and the switches the CLI
 * itself owns.
 *
 * This is a schema rather than a hand-rolled reader because it has two readers
 * besides the plugin: the Loader validates the patch against it before the plugin
 * is activated, and the harness's settings page derives its form from it. Every
 * field carries its default, its bounds and the sentence a person reads next to
 * it, and a patch naming a value the schema refuses is reported rather than
 * silently becoming a default.
 */

import z from "@deepseek-ai/schemastery";

/** The CLI these tools drive by default. */
export const DEFAULT_EXECUTABLE = "agent-browser";

/** A browser command may load a page, so it is given a minute, not seconds. */
const TIMEOUT_MS = 60_000;

/** Roughly ten thousand tokens of answer: plenty for a page, bounded for a context. */
const MAX_OUTPUT_BYTES = 32_768;

/**
 * The live view's own scale.
 *
 * Measured on a real page at 1280x720: quality 30 capped to 640 wide cost 7.5 KB
 * a frame and looked it — a picture drawn a few hundred pixels wide on a dense
 * screen. Full width at quality 60 costs about 31 KB, which is four times the
 * bytes for a picture that is sharp at the size the panel draws it, and a page
 * that has not moved costs nothing at all: the screencast only encodes on paint.
 */
const STREAM_QUALITY = 60;
const STREAM_MAX_WIDTH = 1_280;
const STREAM_MAX_HEIGHT = 800;

/** A person watching a page does not need a video rate. */
const STREAM_MAX_FPS = 8;

/** What a profile patch may say about the browser, and what the settings page edits. */
export const Config = z.object({
	executable: z
		.string()
		.default(DEFAULT_EXECUTABLE)
		.volatile()
		.description(
			"The agent-browser CLI to run: a name on PATH or an absolute path.",
		),
	timeoutMs: z
		.natural()
		.min(1_000)
		.max(600_000)
		.default(TIMEOUT_MS)
		.volatile()
		.description(
			"How long one command may take before it is stopped, in milliseconds.",
		),
	maxOutputBytes: z
		.natural()
		.min(64)
		.max(1_048_576)
		.default(MAX_OUTPUT_BYTES)
		.volatile()
		.description(
			"How much of one answer the model may read, in bytes; the rest is cut at a line boundary.",
		),
	headed: z
		.boolean()
		.default(false)
		.volatile()
		.description(
			"Show the browser window instead of running headless. Applies the next time this conversation's browser starts.",
		),
	chromeProfile: z
		.string()
		.default("")
		.volatile()
		.description(
			"Reuse a real Chrome profile, by name or path, so the browser starts signed in. Risk: the agent can then see and change every site you are already signed in to. Empty means the plugin's own throwaway profile. Applies the next time this conversation's browser starts.",
		),
	allowedDomains: z
		.array(z.string())
		.default([])
		.volatile()
		.description(
			"Domain patterns the CLI itself allows, such as example.com or *.example.com. Empty means no restriction. Applies the next time this conversation's browser starts.",
		),
	streamQuality: z
		.natural()
		.min(1)
		.max(100)
		.default(STREAM_QUALITY)
		.volatile()
		.description(
			"JPEG quality of the live view, 1 to 100. Higher is sharper and costlier; 60 is about 31 KB a frame at 1280 wide. Applies the next time this conversation's browser starts.",
		),
	streamMaxWidth: z
		.natural()
		.min(64)
		.max(3_840)
		.default(STREAM_MAX_WIDTH)
		.volatile()
		.description(
			"The widest frame the live view encodes, in pixels. Narrower viewports are never enlarged. Applies the next time this conversation's browser starts.",
		),
	streamMaxHeight: z
		.natural()
		.min(64)
		.max(2_160)
		.default(STREAM_MAX_HEIGHT)
		.volatile()
		.description(
			"The tallest frame the live view encodes, in pixels. Applies the next time this conversation's browser starts.",
		),
	streamMaxFps: z
		.natural()
		.min(1)
		.max(60)
		.default(STREAM_MAX_FPS)
		.volatile()
		.description(
			"The most frames per second one open panel asks the screencast for. Applies the next time the panel connects.",
		),
});

/** The resolved configuration: every field present, because every field has a default. */
export type BrowserConfig = ReturnType<typeof Config>;

/**
 * The configuration as it is right now.
 *
 * Every field is volatile, which is what the harness's settings page needs to
 * write one at all: a value read at the moment of use picks the edit up on the
 * next command, instead of restarting the plugin and dropping what it was
 * watching. It also makes the read sites honest about which value they mean —
 * `config.executable` here is a getter, not a captured string.
 */
export class BrowserSettings {
	private constructor(private readonly values: BrowserConfig) {}

	/**
	 * Wrap what the Loader validated.
	 * @param values - the schema's own output.
	 */
	static of(values: BrowserConfig): BrowserSettings {
		return new BrowserSettings(values);
	}

	/**
	 * Validate a raw section and fill in what it did not say.
	 *
	 * The Loader does this for the plugin; anything that builds a configuration
	 * by hand — a test, a script — does it through here so there is one answer
	 * to what a missing field means.
	 * @param input - the fields someone set, or nothing at all.
	 * @throws when a field is not a value the schema accepts.
	 */
	static from(input?: Parameters<typeof Config>[0]): BrowserSettings {
		return new BrowserSettings(Config(input));
	}

	/** The CLI to run, by name on PATH or by absolute path. */
	get executable(): string {
		return this.values.executable.get();
	}

	/** How long one command may take before it is stopped. */
	get timeoutMs(): number {
		return this.values.timeoutMs.get();
	}

	/** How much of one answer the model may read. */
	get maxOutputBytes(): number {
		return this.values.maxOutputBytes.get();
	}

	/** Show the browser window instead of running it headless. */
	get headed(): boolean {
		return this.values.headed.get();
	}

	/** A real Chrome profile to reuse, or empty for the plugin's own. */
	get chromeProfile(): string {
		return this.values.chromeProfile.get();
	}

	/** Domain patterns the CLI itself enforces; empty means no restriction. */
	get allowedDomains(): readonly string[] {
		return this.values.allowedDomains.get();
	}

	/** JPEG quality of the live view; the CLI's own scale, 1 to 100. */
	get streamQuality(): number {
		return this.values.streamQuality.get();
	}

	/** The widest frame the live view encodes, in pixels. */
	get streamMaxWidth(): number {
		return this.values.streamMaxWidth.get();
	}

	/** The tallest frame the live view encodes, in pixels. */
	get streamMaxHeight(): number {
		return this.values.streamMaxHeight.get();
	}

	/** The most frames per second one panel asks the screencast for. */
	get streamMaxFps(): number {
		return this.values.streamMaxFps.get();
	}
}

/**
 * The configuration schema, as the Loader and the settings page read it.
 *
 * Two things are checked here: that every field has a default, so a patch may
 * name one setting and say nothing about the rest, and that a value the schema
 * refuses is refused rather than quietly replaced — a settings page that shows
 * "180" for a quality the browser never received would be worse than an error.
 *
 *   bun run test/config.ts
 */

import { expect, test } from "bun:test";
import {
	BrowserSettings,
	Config,
	DEFAULT_EXECUTABLE,
} from "../src/host/config";

test("a patch that says nothing", async () => {
	const bare = BrowserSettings.from();
	expect(
		bare.executable === DEFAULT_EXECUTABLE,
		"runs the CLI by its usual name",
	).toBe(true);
	expect(bare.headed === false, "headless").toBe(true);
	expect(bare.chromeProfile === "", "with no profile to reuse").toBe(true);
	expect(bare.allowedDomains.length === 0, "and no domain policy").toBe(true);
	expect(bare.timeoutMs === 60_000, "a minute per command").toBe(true);
	expect(bare.maxOutputBytes === 32_768, "a bounded answer").toBe(true);
	expect(bare.streamQuality === 60, "a frame sharp enough to read").toBe(true);
	expect(
		bare.streamMaxWidth === 1_280 && bare.streamMaxHeight === 800,
		"no wider than the page it shows",
	).toBe(true);
	expect(bare.streamMaxFps === 8, "and a rate a person watches at").toBe(true);
});
test("a patch that names one thing", async () => {
	const named = BrowserSettings.from({
		headed: true,
		allowedDomains: ["example.com"],
	});
	expect(named.headed === true, "is answered with that thing").toBe(true);
	expect(
		named.allowedDomains[0] === "example.com",
		"and the list it named",
	).toBe(true);
	expect(named.streamQuality === 60, "while the rest keep their defaults").toBe(
		true,
	);
});
test("a patch the schema refuses", async () => {
	const refused = (input: Record<string, unknown>): boolean => {
		try {
			Config(input);

			return false;
		} catch {
			return true;
		}
	};

	expect(refused({ streamQuality: 101 }), "a quality above the scale").toBe(
		true,
	);
	expect(refused({ streamMaxWidth: 0 }), "a zero-width frame").toBe(true);
	expect(refused({ timeoutMs: -1 }), "a negative timeout").toBe(true);
	expect(refused({ maxOutputBytes: 1.5 }), "a fraction of a byte").toBe(true);
	expect(refused({ headed: "yes" }), "a switch that is not a switch").toBe(
		true,
	);

	// A patch written for a newer version must not take the plugin down: the field
	// is carried through untouched and simply not used by this version.
	expect(
		(
			Config({ frobnicate: true } as never) as unknown as {
				frobnicate: boolean;
			}
		).frobnicate === true,
		"while a field this version does not know is carried, not refused",
	).toBe(true);
});
test("what the settings page will offer", async () => {
	expect(
		Object.keys(Config({})).join(",") ===
			[
				"executable",
				"timeoutMs",
				"maxOutputBytes",
				"headed",
				"chromeProfile",
				"allowedDomains",
				"streamQuality",
				"streamMaxWidth",
				"streamMaxHeight",
				"streamMaxFps",
			].join(","),
		"the schema declares exactly the fields the page draws",
	).toBe(true);
});

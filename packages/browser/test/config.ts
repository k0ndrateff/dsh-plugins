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

import {
	BrowserSettings,
	Config,
	DEFAULT_EXECUTABLE,
} from "../src/host/config";
import { check, report, section } from "./harness";

section("a patch that says nothing");
const bare = BrowserSettings.from();
check("runs the CLI by its usual name", bare.executable === DEFAULT_EXECUTABLE);
check("headless", bare.headed === false);
check("with no profile to reuse", bare.chromeProfile === "");
check("and no domain policy", bare.allowedDomains.length === 0);
check("a minute per command", bare.timeoutMs === 60_000);
check("a bounded answer", bare.maxOutputBytes === 32_768);
check("a frame sharp enough to read", bare.streamQuality === 60);
check(
	"no wider than the page it shows",
	bare.streamMaxWidth === 1_280 && bare.streamMaxHeight === 800,
);
check("and a rate a person watches at", bare.streamMaxFps === 8);

section("a patch that names one thing");
const named = BrowserSettings.from({
	headed: true,
	allowedDomains: ["example.com"],
});
check("is answered with that thing", named.headed === true);
check("and the list it named", named.allowedDomains[0] === "example.com");
check("while the rest keep their defaults", named.streamQuality === 60);

section("a patch the schema refuses");
const refused = (input: Record<string, unknown>): boolean => {
	try {
		Config(input);

		return false;
	} catch {
		return true;
	}
};

check("a quality above the scale", refused({ streamQuality: 101 }));
check("a zero-width frame", refused({ streamMaxWidth: 0 }));
check("a negative timeout", refused({ timeoutMs: -1 }));
check("a fraction of a byte", refused({ maxOutputBytes: 1.5 }));
check("a switch that is not a switch", refused({ headed: "yes" }));

// A patch written for a newer version must not take the plugin down: the field
// is carried through untouched and simply not used by this version.
check(
	"while a field this version does not know is carried, not refused",
	(Config({ frobnicate: true } as never) as unknown as { frobnicate: boolean })
		.frobnicate === true,
);

section("what the settings page will offer");
check(
	"the schema declares exactly the fields the page draws",
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
);

report();

/**
 * What a browser tool row says: its label, what a preparing call asked for, and
 * what a settled call found.
 *
 * The row shell, the slot, and the markup belong to `dsh-integration-ui`; these
 * are the pure words of the browser's own line, so every case here is about the
 * text a reader sees and nothing here renders React.
 *
 *   bun test test/tool-rows.test.ts
 */

import { expect, test } from "bun:test";
import {
	askedFor,
	summarize,
	toolLabel,
} from "../src/client/components/tool-text";
import {
	asBrowserMeta,
	asScreenshotMeta,
	asSnapshotMeta,
} from "../src/shared/meta";
import {
	BROWSER_ACT_TOOL,
	BROWSER_CLOSE_TOOL,
	BROWSER_OPEN_TOOL,
	BROWSER_READ_TOOL,
	BROWSER_RUN_TOOL,
	BROWSER_SCREENSHOT_TOOL,
	BROWSER_SNAPSHOT_TOOL,
} from "../src/shared/tools";

const TOOL_NAMES = [
	BROWSER_OPEN_TOOL,
	BROWSER_SNAPSHOT_TOOL,
	BROWSER_ACT_TOOL,
	BROWSER_READ_TOOL,
	BROWSER_RUN_TOOL,
	BROWSER_SCREENSHOT_TOOL,
	BROWSER_CLOSE_TOOL,
];

test("each tool has a label of its own", () => {
	expect(TOOL_NAMES.map(toolLabel).join(",")).toBe(
		"Browser page,Browser snapshot,Browser action,Browser read,Browser command,Browser screenshot,Browser close",
	);
	expect(
		new Set(TOOL_NAMES.map(toolLabel)).size === TOOL_NAMES.length,
		"no two tools share a label",
	).toBe(true);
	expect(
		toolLabel("browser_unknown") === "Browser",
		"a name this version does not draw is still the browser's",
	).toBe(true);
	expect(
		toolLabel(undefined) === "Browser",
		"and so is a row without a name at all",
	).toBe(true);
});

test("a preparing call says what it asked for", () => {
	expect(
		askedFor({ url: "http://x/checkout" }) === "http://x/checkout",
		"opening names the address",
	).toBe(true);
	expect(
		askedFor({ action: "click", target: "@e3" }) === "click @e3",
		"acting names the verb and its target",
	).toBe(true);
	expect(
		askedFor({ what: "console" }) === "console",
		"reading names the log",
	).toBe(true);
	expect(
		askedFor({ args: ["tab", "list"] }) === "tab list",
		"a command is the words it was given",
	).toBe(true);
	expect(
		askedFor({ args: ["tab", 42, "list"] }) === "tab list",
		"with anything that is not a word dropped",
	).toBe(true);
	expect(
		askedFor({ interactive: false }) === "whole tree",
		"a snapshot says how much of the tree it wants",
	).toBe(true);
	expect(
		askedFor({ interactive: true }) === "interactive elements",
		"including the default one",
	).toBe(true);
	expect(
		askedFor({ selector: "#main" }) === "#main",
		"a selector names the part of the page",
	).toBe(true);
	expect(
		askedFor({ format: "jpeg", full: true }) === "full page · jpeg",
		"a screenshot names the framing and the format",
	).toBe(true);
	expect(
		askedFor({
			selector: "#main",
			interactive: false,
			full: true,
			format: "png",
		}) === "#main · whole tree · full page · png",
		"every detail it can name is on the line",
	).toBe(true);
	expect(
		askedFor({}) === undefined,
		"a call with nothing recognizable has nothing specific to say",
	).toBe(true);
	expect(
		askedFor({ url: "   " }) === undefined,
		"and neither does a blank one",
	).toBe(true);
});

test("a settled call says what it found", () => {
	const found = (meta: unknown): string => summarize({ meta });

	expect(found({ session: "dsh-1", url: "http://x/", title: "Checkout" })).toBe(
		"Checkout",
	);
	expect(
		found({ session: "dsh-1", url: "http://x/checkout", title: "" }),
		"a page with no title is named by its address",
	).toBe("http://x/checkout");
	expect(found({ session: "dsh-1", url: "", title: "" })).toBe("opened");

	expect(
		found({ elements: 12, url: "http://x/", interactive: true, selector: "" }),
	).toBe("12 elements · http://x/");
	expect(
		found({ elements: 1, url: "", interactive: false, selector: "" }),
	).toBe("1 element");
	expect(found({ elements: 0, url: "", interactive: true, selector: "" })).toBe(
		"0 elements",
	);

	expect(
		found({
			action: "click",
			target: "@e3",
			url: "http://x/next",
			addressUnread: false,
		}),
	).toBe("clicked @e3 · http://x/next");
	expect(
		found({ action: "click", target: "@e3", url: "", addressUnread: true }),
		"an address that could not be read is said, not left blank",
	).toBe("clicked @e3 · address unread");
	expect(
		found({ action: "scroll", target: "down", url: "", addressUnread: false }),
	).toBe("scrolled down");
	expect(
		found({ action: "submit", target: "#go", url: "", addressUnread: false }),
		"a verb this version does not know is read as words, not dropped",
	).toBe("submit #go");

	expect(found({ what: "console", count: 4 })).toBe("console · 4 lines");
	expect(found({ what: "errors", count: 1 })).toBe("errors · 1 line");
	expect(found({ what: "text", count: 0 })).toBe("text · 0 lines");

	expect(found({ command: "tab list", empty: false })).toBe("tab list");
	expect(found({ command: "eval 1+1", empty: true })).toBe(
		"eval 1+1 · no answer",
	);

	expect(
		found({
			url: "http://x/",
			format: "png",
			bytes: 63_488,
			width: 1_280,
			height: 720,
		}),
	).toBe("1280×720 png · 62 KB");
	expect(found({ url: "", format: "jpeg", bytes: 5_120 })).toBe("jpeg · 5 KB");
	expect(found({ url: "", format: "png", bytes: 900 })).toBe("png · 900 bytes");
	expect(
		found({ url: "", format: "png", bytes: 1_234, width: 1_280 }),
		"a picture whose height was not recorded is named by its format",
	).toBe("png · 1 KB");

	expect(found({ closed: true })).toBe("closed");
	expect(found({ closed: false })).toBe("no browser was open");
});

test("a call whose metadata this version cannot read falls back to its answer", () => {
	expect(
		summarize({
			content: [{ type: "text", text: "Opened the page.\nhttp://x/" }],
		}),
		"the server's first line stands in for a row",
	).toBe("Opened the page.");
	expect(
		summarize({
			meta: { kind: "from-a-newer-version" },
			content: [{ type: "text", text: "something this half cannot narrow" }],
		}),
	).toBe("something this half cannot narrow");
	expect(summarize({})).toBe("done");
	expect(summarize(undefined)).toBe("done");

	const long = summarize({
		content: [{ type: "text", text: "x".repeat(200) }],
	});

	expect(long.length === 80, "a tree is cut to one line").toBe(true);
	expect(long.endsWith("…")).toBe(true);
});

test("the metadata readers know every shape and reject the rest", () => {
	expect(asBrowserMeta({ session: "s", url: "u", title: "t" })?.kind).toBe(
		"open",
	);
	expect(
		asBrowserMeta({ elements: 3, url: "u", interactive: true, selector: "" })
			?.kind,
	).toBe("snapshot");
	expect(
		asBrowserMeta({
			action: "click",
			target: "@e1",
			url: "u",
			addressUnread: false,
		})?.kind,
	).toBe("act");
	expect(asBrowserMeta({ what: "console", count: 1 })?.kind).toBe("read");
	expect(asBrowserMeta({ command: "tab list", empty: false })?.kind).toBe(
		"run",
	);
	expect(asBrowserMeta({ url: "u", format: "png", bytes: 10 })?.kind).toBe(
		"screenshot",
	);
	expect(asBrowserMeta({ closed: true })?.kind).toBe("close");

	expect(asBrowserMeta({}) === undefined).toBe(true);
	expect(asBrowserMeta(null) === undefined).toBe(true);
	expect(asBrowserMeta("snapshot") === undefined).toBe(true);
	expect(
		asBrowserMeta({ elements: "3" }) === undefined,
		"a count that is not a number is not a count",
	).toBe(true);
	expect(
		asBrowserMeta({ command: "tab list" }) === undefined,
		"a shape missing a required field is not that shape",
	).toBe(true);
	expect(
		asBrowserMeta({ action: "click", target: "@e1" }) === undefined,
		"and neither is an act without its address flag",
	).toBe(true);
});

test("a screenshot without stored dimensions records no dimensions", () => {
	const meta = asScreenshotMeta({ url: "", format: "png", bytes: 10 });

	expect(meta === undefined).toBe(false);
	expect(meta !== undefined && "width" in meta).toBe(false);
	expect(meta !== undefined && "height" in meta).toBe(false);
	expect(
		asSnapshotMeta({
			elements: 1,
			url: "",
			interactive: true,
			selector: "",
		}),
	).toEqual({ elements: 1, url: "", interactive: true, selector: "" });
});

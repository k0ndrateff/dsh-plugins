/**
 * The feed, as a reader gets it.
 *
 * The stream reports a command and then its outcome; the panel shows one line
 * for the pair, with a verb a person understands. Everything here is pure, so
 * the folding is checked without a browser.
 *
 *   bun run test/feed.ts
 */

import { feedLines } from "../src/client/sidebar/feed";
import type { PanelActivity } from "../src/shared/panel";
import { check, report, section } from "./harness";

/** One command and one outcome, as the host reports them. */
const pair = (
	command: string,
	result: string,
	at = 1,
): readonly PanelActivity[] => [
	{ kind: "command", text: command, at },
	{ kind: "result", text: result, at: at + 1 },
];

section("a command and its outcome");
const clicked = feedLines(pair("click @e2", "19ms"));
check("are one line", clicked.length === 1);
check("named as a person would", clicked[0]?.label === "Clicked");
check("with what it acted on", clicked[0]?.detail === "@e2");
check("and how long it took", clicked[0]?.durationMs === 19);

section("a command with nothing to act on");
const snapshot = feedLines(pair("snapshot", "8ms"));
check("still reads as a sentence", snapshot[0]?.label === "Took a snapshot");
check("without a detail", snapshot[0]?.detail === "");
check("and keeps its duration", snapshot[0]?.durationMs === 8);

section("commands nobody taught it");
const unknown = feedLines([{ kind: "command", text: "frobnicate @e9", at: 3 }]);
check("keep their own name", unknown[0]?.label === "frobnicate");
check("and their detail", unknown[0]?.detail === "@e9");
check("and wait for an outcome", unknown[0]?.durationMs === undefined);

section("what the folding refuses");
check(
	"an outcome with no command is not a line",
	feedLines([{ kind: "result", text: "8ms", at: 1 }]).length === 0,
);
check(
	"a second outcome does not overwrite the first",
	feedLines([
		{ kind: "command", text: "click @e2", at: 1 },
		{ kind: "result", text: "19ms", at: 2 },
		{ kind: "result", text: "99ms", at: 3 },
	]).length === 1,
);
check(
	"and the first one is the one kept",
	feedLines([
		{ kind: "command", text: "click @e2", at: 1 },
		{ kind: "result", text: "19ms", at: 2 },
		{ kind: "result", text: "99ms", at: 3 },
	])[0]?.durationMs === 19,
);
check(
	"an outcome that is not a duration is no duration",
	feedLines(pair("click @e2", "done"))[0]?.durationMs === undefined,
);

section("a whole run");
const run = feedLines([
	...pair("snapshot", "8ms", 1),
	...pair("click @e2", "19ms", 3),
	...pair("url", "8ms", 5),
	...pair("back", "506ms", 7),
]);
check("one line per action", run.length === 4);
check(
	"in the order they happened",
	run.map((line) => line.label).join(" | ") ===
		"Took a snapshot | Clicked | Read the address | Went back",
);

report();

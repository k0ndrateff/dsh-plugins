/**
 * The feed, as a reader gets it.
 *
 * The stream reports a command and then its outcome; the panel shows one line
 * for the pair, with a verb a person understands. Everything here is pure, so
 * the folding is checked without a browser.
 *
 *   bun run test/feed.ts
 */

import { expect, test } from "bun:test";
import { feedLines } from "../src/client/sidebar/feed";
import type { PanelActivity } from "../src/shared/panel";

/** One command and one outcome, as the host reports them. */
const pair = (
	command: string,
	result: string,
	at = 1,
): readonly PanelActivity[] => [
	{ kind: "command", text: command, at },
	{ kind: "result", text: result, at: at + 1 },
];

test("a command and its outcome", async () => {
	const clicked = feedLines(pair("click @e2", "19ms"));
	expect(clicked.length === 1, "are one line").toBe(true);
	expect(clicked[0]?.label === "Clicked", "named as a person would").toBe(true);
	expect(clicked[0]?.detail === "@e2", "with what it acted on").toBe(true);
	expect(clicked[0]?.durationMs === 19, "and how long it took").toBe(true);
});
test("a command with nothing to act on", async () => {
	const snapshot = feedLines(pair("snapshot", "8ms"));
	expect(
		snapshot[0]?.label === "Took a snapshot",
		"still reads as a sentence",
	).toBe(true);
	expect(snapshot[0]?.detail === "", "without a detail").toBe(true);
	expect(snapshot[0]?.durationMs === 8, "and keeps its duration").toBe(true);
});
test("commands nobody taught it", async () => {
	const unknown = feedLines([
		{ kind: "command", text: "frobnicate @e9", at: 3 },
	]);
	expect(unknown[0]?.label === "frobnicate", "keep their own name").toBe(true);
	expect(unknown[0]?.detail === "@e9", "and their detail").toBe(true);
	expect(unknown[0]?.durationMs === undefined, "and wait for an outcome").toBe(
		true,
	);
});
test("what the folding refuses", async () => {
	expect(
		feedLines([{ kind: "result", text: "8ms", at: 1 }]).length === 0,
		"an outcome with no command is not a line",
	).toBe(true);
	expect(
		feedLines([
			{ kind: "command", text: "click @e2", at: 1 },
			{ kind: "result", text: "19ms", at: 2 },
			{ kind: "result", text: "99ms", at: 3 },
		]).length === 1,
		"a second outcome does not overwrite the first",
	).toBe(true);
	expect(
		feedLines([
			{ kind: "command", text: "click @e2", at: 1 },
			{ kind: "result", text: "19ms", at: 2 },
			{ kind: "result", text: "99ms", at: 3 },
		])[0]?.durationMs === 19,
		"and the first one is the one kept",
	).toBe(true);
	expect(
		feedLines(pair("click @e2", "done"))[0]?.durationMs === undefined,
		"an outcome that is not a duration is no duration",
	).toBe(true);
});
test("what the CLI calls a resize", async () => {
	expect(
		feedLines([{ kind: "command", text: "viewport", at: 4 }])[0]?.label ===
			"Resized the page",
		"is a sentence a reader understands",
	).toBe(true);
});
test("the person's own acts", async () => {
	const mine = feedLines([{ kind: "human", text: "click 412×188", at: 9 }]);
	expect(mine[0]?.label === "You clicked", "read in the first person").toBe(
		true,
	);
	expect(mine[0]?.detail === "412×188", "with where it landed").toBe(true);
	expect(
		mine[0]?.durationMs === undefined,
		"and no duration, because nobody timed it",
	).toBe(true);
	expect(
		feedLines([
			{ kind: "human", text: "click 1×2", at: 1 },
			{ kind: "result", text: "8ms", at: 2 },
		])[0]?.durationMs === undefined,
		"the agent's next outcome does not fold into it",
	).toBe(true);
	expect(
		feedLines([{ kind: "human", text: "key Enter", at: 3 }])[0]?.label ===
			"You pressed",
		"and a key reads as a key",
	).toBe(true);
	expect(
		feedLines([{ kind: "human", text: "type hello", at: 3 }])[0]?.label ===
			"You typed",
		"a typed word says so",
	).toBe(true);
	expect(
		feedLines([{ kind: "human", text: "type hello", at: 3 }])[0]?.detail ===
			"hello",
		"with what was typed",
	).toBe(true);
	expect(
		feedLines([{ kind: "human", text: "back", at: 3 }])[0]?.label ===
			"You went back",
		"a navigation the person made is theirs",
	).toBe(true);
	expect(
		feedLines([{ kind: "human", text: "resize 390×844", at: 3 }])[0]?.label ===
			"You resized the page",
		"and so is a page size",
	).toBe(true);
});
test("a whole run", async () => {
	const run = feedLines([
		...pair("snapshot", "8ms", 1),
		...pair("click @e2", "19ms", 3),
		...pair("url", "8ms", 5),
		...pair("back", "506ms", 7),
	]);
	expect(run.length === 4, "one line per action").toBe(true);
	expect(
		run.map((line) => line.label).join(" | ") ===
			"Took a snapshot | Clicked | Read the address | Went back",
		"in the order they happened",
	).toBe(true);
});

/**
 * Cutting an answer down, and saying so.
 *
 * The point of every case here is that a reader must be able to tell a short
 * answer from a truncated one: a page reported as complete when half of it was
 * dropped is a worse failure than a page reported as cut.
 *
 *   bun run test/text.ts
 */

import { test } from "bun:test";
import { check } from "../../../test/support";
import { bound, errorText, jsonText } from "../src/host/text";

test("an answer inside the cap", async () => {
	const short = '- button "Poke me" [ref=e1]';
	check("is returned unchanged", bound(short, 1_000) === short);
	check("a cap of exactly its size still fits", bound("abcd", 4) === "abcd");
});
test("an answer over the cap", async () => {
	const long = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
	const cut = bound(long, 40);
	check("keeps whole lines", cut.startsWith("line 1\nline 2"));
	check(
		"keeps them whole to the last one",
		cut.split("\n").includes("line 5") && !cut.split("\n").includes("line 6"),
	);
	check("says how many lines went", /…and \d+ more lines/.test(cut));
	check("says where it was cut", cut.includes("cut at 40 bytes"));
	check(
		"one dropped line reads in the singular",
		bound("aa\nbb\ncc", 6).includes("1 more line"),
	);
	check(
		"a single line over the cap still says something",
		bound("x".repeat(100), 10).startsWith("…and 1 more line"),
	);
});
test("the reason inside a thrown value", async () => {
	check("an Error is its message", errorText(new Error("nope")) === "nope");
	check("anything else is stringified", errorText(7) === "7");
});
test("one JSON value as text", async () => {
	check(
		"an object is indented by one space",
		jsonText({ a: 1 }) === '{\n "a": 1\n}',
	);
	check("nothing is the empty string", jsonText(undefined) === "");
	check("a string stays a string", jsonText("hi") === '"hi"');
});

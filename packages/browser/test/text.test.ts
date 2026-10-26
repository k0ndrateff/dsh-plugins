/**
 * Cutting an answer down, and saying so.
 *
 * The point of every case here is that a reader must be able to tell a short
 * answer from a truncated one: a page reported as complete when half of it was
 * dropped is a worse failure than a page reported as cut.
 *
 *   bun run test/text.ts
 */

import { expect, test } from "bun:test";
import { bound, errorText, jsonText } from "../src/host/text";

test("an answer inside the cap", async () => {
	const short = '- button "Poke me" [ref=e1]';
	expect(bound(short, 1_000) === short, "is returned unchanged").toBe(true);
	expect(
		bound("abcd", 4) === "abcd",
		"a cap of exactly its size still fits",
	).toBe(true);
});
test("an answer over the cap", async () => {
	const long = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
	const cut = bound(long, 40);
	expect(cut.startsWith("line 1\nline 2"), "keeps whole lines").toBe(true);
	expect(
		cut.split("\n").includes("line 5") && !cut.split("\n").includes("line 6"),
		"keeps them whole to the last one",
	).toBe(true);
	expect(/…and \d+ more lines/.test(cut), "says how many lines went").toBe(
		true,
	);
	expect(cut.includes("cut at 40 bytes"), "says where it was cut").toBe(true);
	expect(
		bound("aa\nbb\ncc", 6).includes("1 more line"),
		"one dropped line reads in the singular",
	).toBe(true);
	expect(
		bound("x".repeat(100), 10).startsWith("x") &&
			bound("x".repeat(100), 10).includes("cut at 10 bytes"),
		"a single line over the cap is cut inside itself rather than dropped whole",
	).toBe(true);
});
test("the reason inside a thrown value", async () => {
	expect(
		errorText(new Error("nope")) === "nope",
		"an Error is its message",
	).toBe(true);
	expect(errorText(7) === "7", "anything else is stringified").toBe(true);
});
test("one JSON value as text", async () => {
	expect(
		jsonText({ a: 1 }) === '{\n "a": 1\n}',
		"an object is indented by one space",
	).toBe(true);
	expect(jsonText(undefined) === "", "nothing is the empty string").toBe(true);
	expect(jsonText("hi") === '"hi"', "a string stays a string").toBe(true);
});

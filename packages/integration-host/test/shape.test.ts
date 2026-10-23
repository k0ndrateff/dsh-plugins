import { describe, expect, test } from "bun:test";
import {
	fallback,
	isTrue,
	list,
	literal,
	nonEmptyString,
	notFalse,
	object,
	oneOf,
	optional,
	required,
	string,
	trueOnly,
} from "../src/shape";

describe("shape readers", () => {
	const comment = object<{ body: string; author?: string }>({
		body: required(nonEmptyString),
		author: optional(nonEmptyString),
	});

	test("keeps a required field and omits an absent optional one", () => {
		expect(comment({ body: "hello" })).toEqual({ body: "hello" });
	});

	test("rejects a document whose required field is missing or malformed", () => {
		expect(comment({ author: "Ada" })).toBeUndefined();
		expect(comment({ body: "" })).toBeUndefined();
		expect(comment("not a record")).toBeUndefined();
	});

	test("keeps only the items a list reader accepts", () => {
		const read = list(comment);

		expect(read([{ body: "a" }, { body: "" }, 42, { body: "b" }])).toEqual([
			{ body: "a" },
			{ body: "b" },
		]);
		expect(read(undefined)).toEqual([]);
	});

	test("takes the first shape that accepts a value", () => {
		type Target =
			| { readonly kind: "a"; readonly a: string }
			| { readonly kind: "b"; readonly b: string };

		const read = oneOf<Target>(
			object<{ kind: "a"; a: string }>({
				kind: required(literal("a")),
				a: required(string),
			}),
			object<{ kind: "b"; b: string }>({
				kind: required(literal("b")),
				b: required(string),
			}),
		);

		expect(read({ kind: "b", b: "x" })).toEqual({ kind: "b", b: "x" });
		expect(read({ kind: "c" })).toBeUndefined();
	});

	test("reads Jira's two boolean spellings", () => {
		expect(notFalse(undefined)).toBe(true);
		expect(notFalse(false)).toBe(false);
		expect(notFalse("false")).toBe(true);
		expect(isTrue(true)).toBe(true);
		expect(isTrue("true")).toBe(false);
		expect(trueOnly(true)).toBe(true);
		expect(trueOnly(false)).toBeUndefined();
	});

	test("falls back when a value is absent", () => {
		const read = object<{ depth: number }>({
			depth: fallback(
				(value) => (typeof value === "number" ? value : undefined),
				0,
			),
		});

		expect(read({})).toEqual({ depth: 0 });
		expect(read({ depth: 2 })).toEqual({ depth: 2 });
	});
});

/**
 * Reading one answer from the CLI.
 *
 * The shapes here are the ones the live CLI was seen to answer with, including
 * the two that are not command envelopes at all: `doctor`'s own report, and the
 * `unknown_command` failure that arrives without a `data` field.
 *
 *   bun run test/envelope.ts
 */

import { expect, test } from "bun:test";
import {
	fieldOf,
	isList,
	isRecord,
	isText,
	modelData,
	parseEnvelope,
} from "../src/host/envelope";

test("a command envelope", async () => {
	const success = parseEnvelope(
		'{"success":true,"data":{"url":"http://x","title":"X"},"error":null}',
	);
	expect(success?.ok === true, "success is read as success").toBe(true);
	expect(
		fieldOf(modelData(success?.data), "url", isText) === "http://x",
		"its payload survives",
	).toBe(true);

	const failure = parseEnvelope(
		'{"error":"Unknown command: frobnicate","success":false,"type":"unknown_command"}',
	);
	expect(failure?.ok === false, "failure is read as failure").toBe(true);
	expect(
		failure?.error === "Unknown command: frobnicate",
		"its reason survives",
	).toBe(true);

	expect(
		parseEnvelope('{"success":false,"error":null}')?.error === undefined,
		"a failure without a reason still reads",
	).toBe(true);
});
test("what is not a command envelope", async () => {
	expect(
		parseEnvelope('{"checks":[{"id":"env.version"}]}') === undefined,
		"doctor's own report is not one",
	).toBe(true);
	expect(parseEnvelope("[1,2]") === undefined, "an array is not one").toBe(
		true,
	);
	expect(parseEnvelope('"ok"') === undefined, "a bare string is not one").toBe(
		true,
	);
	expect(parseEnvelope("{nope") === undefined, "broken JSON is not one").toBe(
		true,
	);
	expect(parseEnvelope("   ") === undefined, "nothing at all is not one").toBe(
		true,
	);
});
test("the fields that ride every answer", async () => {
	const stripped = modelData({
		url: "http://x",
		lifecycle: { effectiveLaunch: { browserLaunched: true } },
		targetId: "5F2C",
	}) as Record<string, unknown>;
	expect(stripped.lifecycle === undefined, "lifecycle is dropped").toBe(true);
	expect(stripped.targetId === undefined, "the CDP target is dropped").toBe(
		true,
	);
	expect(stripped.url === "http://x", "the answer itself is kept").toBe(true);
	expect(
		Array.isArray(modelData([{ lifecycle: 1 }])),
		"a list is passed through",
	).toBe(true);
	expect(modelData("hi") === "hi", "a string is passed through").toBe(true);
});
test("reading one named field", async () => {
	const payload = { url: "http://x", refs: { e1: { role: "button" } } };
	expect(
		fieldOf(payload, "url", isText) === "http://x",
		"a string field is read",
	).toBe(true);
	expect(
		fieldOf(payload, "url", isList) === undefined,
		"a wrong type is refused",
	).toBe(true);
	expect(
		fieldOf(payload, "nope", isText) === undefined,
		"a missing field is undefined",
	).toBe(true);
	expect(
		fieldOf(payload, "refs", isRecord) !== undefined,
		"a named-fields field is read",
	).toBe(true);
	expect(
		fieldOf(payload, "refs", isList) === undefined,
		"and is not mistaken for a list",
	).toBe(true);
	expect(
		fieldOf({ messages: [] }, "messages", isRecord) === undefined,
		"a list is not mistaken for named fields",
	).toBe(true);
	expect(
		fieldOf(undefined, "url", isText) === undefined,
		"a non-object payload has no fields",
	).toBe(true);
});

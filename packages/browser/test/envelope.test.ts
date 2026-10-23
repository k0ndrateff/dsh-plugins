/**
 * Reading one answer from the CLI.
 *
 * The shapes here are the ones the live CLI was seen to answer with, including
 * the two that are not command envelopes at all: `doctor`'s own report, and the
 * `unknown_command` failure that arrives without a `data` field.
 *
 *   bun run test/envelope.ts
 */

import { test } from "bun:test";
import { check } from "../../../test/support";
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
	check("success is read as success", success?.ok === true);
	check(
		"its payload survives",
		fieldOf(modelData(success?.data), "url", isText) === "http://x",
	);

	const failure = parseEnvelope(
		'{"error":"Unknown command: frobnicate","success":false,"type":"unknown_command"}',
	);
	check("failure is read as failure", failure?.ok === false);
	check(
		"its reason survives",
		failure?.error === "Unknown command: frobnicate",
	);

	check(
		"a failure without a reason still reads",
		parseEnvelope('{"success":false,"error":null}')?.error === undefined,
	);
});
test("what is not a command envelope", async () => {
	check(
		"doctor's own report is not one",
		parseEnvelope('{"checks":[{"id":"env.version"}]}') === undefined,
	);
	check("an array is not one", parseEnvelope("[1,2]") === undefined);
	check("a bare string is not one", parseEnvelope('"ok"') === undefined);
	check("broken JSON is not one", parseEnvelope("{nope") === undefined);
	check("nothing at all is not one", parseEnvelope("   ") === undefined);
});
test("the fields that ride every answer", async () => {
	const stripped = modelData({
		url: "http://x",
		lifecycle: { effectiveLaunch: { browserLaunched: true } },
		targetId: "5F2C",
	}) as Record<string, unknown>;
	check("lifecycle is dropped", stripped.lifecycle === undefined);
	check("the CDP target is dropped", stripped.targetId === undefined);
	check("the answer itself is kept", stripped.url === "http://x");
	check(
		"a list is passed through",
		Array.isArray(modelData([{ lifecycle: 1 }])),
	);
	check("a string is passed through", modelData("hi") === "hi");
});
test("reading one named field", async () => {
	const payload = { url: "http://x", refs: { e1: { role: "button" } } };
	check(
		"a string field is read",
		fieldOf(payload, "url", isText) === "http://x",
	);
	check(
		"a wrong type is refused",
		fieldOf(payload, "url", isList) === undefined,
	);
	check(
		"a missing field is undefined",
		fieldOf(payload, "nope", isText) === undefined,
	);
	check(
		"a named-fields field is read",
		fieldOf(payload, "refs", isRecord) !== undefined,
	);
	check(
		"and is not mistaken for a list",
		fieldOf(payload, "refs", isList) === undefined,
	);
	check(
		"a list is not mistaken for named fields",
		fieldOf({ messages: [] }, "messages", isRecord) === undefined,
	);
	check(
		"a non-object payload has no fields",
		fieldOf(undefined, "url", isText) === undefined,
	);
});

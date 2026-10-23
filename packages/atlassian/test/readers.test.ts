/**
 * What the Atlassian reader makes of the text a document carries.
 *
 * The extractor is what turns a Jira or Confluence field into the string the
 * panel renders and the model reads, so this is where the provider's own
 * conventions are read rather than where a card is assembled — `digest.test.ts`
 * covers that.
 */

import { describe, expect, test } from "bun:test";
import { extractor } from "../src/host/presentation/extract";

describe("the text of a Jira or Confluence field", () => {
	test("keeps the prose around a comment Jira wrote for its editors", () => {
		expect(
			extractor.text(
				"Fixed the parser.\n\n<!-- ship after the migration -->\n\nSee DEV-6477.",
			),
		).toBe("Fixed the parser.\n\nSee DEV-6477.");
	});

	test("leaves the sentence an inline comment interrupted", () => {
		expect(extractor.text("Reverted <!-- for now --> the change.")).toBe(
			"Reverted the change.",
		);
	});

	test("keeps a fenced example of a comment as content", () => {
		expect(extractor.text("```html\n<!-- an example -->\n```")).toBe(
			"```html\n<!-- an example -->\n```",
		);
	});

	test("keeps indentation inside a fence", () => {
		expect(extractor.text("```ts\n    y();\n```")).toBe("```ts\n    y();\n```");
	});
});

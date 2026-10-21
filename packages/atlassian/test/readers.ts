/**
 * What the Atlassian reader makes of the text a document carries.
 *
 * The extractor is what turns a Jira or Confluence field into the string the
 * panel renders and the model reads, so this is where the provider's own
 * conventions are read rather than where a card is assembled — `digest.ts`
 * covers that, and the live OAuth run is `dry-run.ts`.
 *
 *   bun run test/readers.ts
 */

import { extractor } from "../src/host/presentation/extract";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

check(
	"a body keeps the prose around a comment Jira wrote for its editors",
	extractor.text(
		"Fixed the parser.\n\n<!-- ship after the migration -->\n\nSee DEV-6477.",
	) === "Fixed the parser.\n\nSee DEV-6477.",
);

check(
	"an inline comment leaves the sentence it interrupted",
	extractor.text("Reverted <!-- for now --> the change.") ===
		"Reverted the change.",
);

check(
	"a fenced example of a comment is content, and stays",
	extractor.text("```html\n<!-- an example -->\n```") ===
		"```html\n<!-- an example -->\n```",
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

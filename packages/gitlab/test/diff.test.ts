/**
 * The patch reader behind the Diff tab.
 *
 *   bun run test/diff.ts
 *
 * The cases that matter are the ones GitLab's own fixtures miss: two hunks in
 * one file must stay two, and a changed line whose text starts with `--` or
 * `++` is content, not a file header.
 */

import { expect, test } from "bun:test";
import { patchToHunks } from "../src/client/diff";
import type { DiffFile } from "../src/shared/panel";

const file = (patch: string, extra: Partial<DiffFile> = {}): DiffFile => ({
	path: "a.sql",
	added: 0,
	removed: 0,
	newFile: false,
	deletedFile: false,
	renamedFile: false,
	patch,
	...extra,
});

test("one hunk", async () => {
	{
		const hunks = patchToHunks(
			file("@@ -1,4 +1,4 @@\n keep\n--- old\n+++ new\n tail\n"),
		);

		expect(hunks.length === 1, "one hunk is one entry").toBe(true);
		expect(
			hunks[0]?.oldText === "keep\n-- old\ntail",
			`a removed line may start with -- — ${JSON.stringify(hunks[0]?.oldText)}`,
		).toBe(true);
		expect(
			hunks[0]?.newText === "keep\n++ new\ntail",
			`an added line may start with ++ — ${JSON.stringify(hunks[0]?.newText)}`,
		).toBe(true);
	}
});
test("two hunks", async () => {
	{
		const hunks = patchToHunks(
			file(
				"--- a/a.sql\n+++ b/a.sql\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -50,2 +50,2 @@\n x\n-y\n+Y\n",
			),
		);

		expect(
			hunks.length === 2,
			`each @@ becomes its own entry — ${String(hunks.length)}`,
		).toBe(true);
		expect(
			hunks[0]?.oldText === "a\nb" && hunks[0]?.newText === "a\nB",
			`the first hunk keeps its own lines — ${JSON.stringify(hunks[0])}`,
		).toBe(true);
		expect(
			hunks[1]?.oldText === "x\ny" && hunks[1]?.newText === "x\nY",
			`the second hunk does not absorb the first — ${JSON.stringify(hunks[1])}`,
		).toBe(true);
	}
});
test("what is not content", async () => {
	{
		const hunks = patchToHunks(
			file(
				"diff --git a/a.sql b/a.sql\nindex 111..222 100644\n--- a/a.sql\n+++ b/a.sql\n@@ -1 +1 @@\n-a\n+b\n",
			),
		);

		expect(
			hunks.length === 1,
			"metadata before the first hunk is dropped",
		).toBe(true);
		expect(
			hunks[0]?.oldText === "a" && hunks[0]?.newText === "b",
			`and the change remains — ${JSON.stringify(hunks[0])}`,
		).toBe(true);

		const created = patchToHunks(
			file("@@ -0,0 +1,2 @@\n+one\n+two\n", { newFile: true }),
		);

		expect(
			created[0]?.oldText === null && created[0]?.newText === "one\ntwo",
			`a new file has no prior text — ${JSON.stringify(created[0])}`,
		).toBe(true);
	}
});

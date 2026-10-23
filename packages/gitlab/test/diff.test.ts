/**
 * The patch reader behind the Diff tab.
 *
 *   bun run test/diff.ts
 *
 * The cases that matter are the ones GitLab's own fixtures miss: two hunks in
 * one file must stay two, and a changed line whose text starts with `--` or
 * `++` is content, not a file header.
 */

import { test } from "bun:test";
import { check } from "../../../test/support";
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

		check("one hunk is one entry", hunks.length === 1);
		check(
			"a removed line may start with --",
			hunks[0]?.oldText === "keep\n-- old\ntail",
			JSON.stringify(hunks[0]?.oldText),
		);
		check(
			"an added line may start with ++",
			hunks[0]?.newText === "keep\n++ new\ntail",
			JSON.stringify(hunks[0]?.newText),
		);
	}
});
test("two hunks", async () => {
	{
		const hunks = patchToHunks(
			file(
				"--- a/a.sql\n+++ b/a.sql\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -50,2 +50,2 @@\n x\n-y\n+Y\n",
			),
		);

		check(
			"each @@ becomes its own entry",
			hunks.length === 2,
			String(hunks.length),
		);
		check(
			"the first hunk keeps its own lines",
			hunks[0]?.oldText === "a\nb" && hunks[0]?.newText === "a\nB",
			JSON.stringify(hunks[0]),
		);
		check(
			"the second hunk does not absorb the first",
			hunks[1]?.oldText === "x\ny" && hunks[1]?.newText === "x\nY",
			JSON.stringify(hunks[1]),
		);
	}
});
test("what is not content", async () => {
	{
		const hunks = patchToHunks(
			file(
				"diff --git a/a.sql b/a.sql\nindex 111..222 100644\n--- a/a.sql\n+++ b/a.sql\n@@ -1 +1 @@\n-a\n+b\n",
			),
		);

		check("metadata before the first hunk is dropped", hunks.length === 1);
		check(
			"and the change remains",
			hunks[0]?.oldText === "a" && hunks[0]?.newText === "b",
			JSON.stringify(hunks[0]),
		);

		const created = patchToHunks(
			file("@@ -0,0 +1,2 @@\n+one\n+two\n", { newFile: true }),
		);

		check(
			"a new file has no prior text",
			created[0]?.oldText === null && created[0]?.newText === "one\ntwo",
			JSON.stringify(created[0]),
		);
	}
});

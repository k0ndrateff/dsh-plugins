/**
 * Turning GitLab's unified patch into the shape the diff surface renders.
 *
 * GitLab answers the diff facet with patch text — `@@` hunks whose lines carry
 * `+`, `-`, or a leading space — while the UI kit's diff surface renders one
 * change as the prior text and the text after it. The two carry the same
 * information, and this is the one place that reads one into the other: a
 * context line belongs to both sides, a removed line only to the prior text, an
 * added line only to the new one.
 *
 * A file the patch cannot describe — a binary change, or a facet that answered
 * with statistics only — has no hunk, and the caller draws the file's header
 * without a diff under it.
 */

import type { DiffHunk } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DiffFile } from "../shared/panel";

/** `@@ -1,4 +1,6 @@`, which separates hunks but carries nothing to render. */
const HUNK_HEADER = /^@@/u;

/** `--- a/path` and `+++ b/path`, which the file's own header already says. */
const FILE_HEADER = /^(?:---|\+\+\+)(?:\s|$)/u;

/** `\ No newline at end of file`, which is about the file rather than a line. */
const NO_NEWLINE = /^\\/u;

/**
 * Read one changed file's patch into the diff surface's own shape.
 * @param file - one file of the merge request's diff.
 * @returns the hunk to render, or undefined when there is no patch to render.
 */
export function patchToHunk(file: DiffFile): DiffHunk | undefined {
	const patch = file.patch;
	if (patch === undefined || patch.trim() === "") return undefined;

	const before: string[] = [];
	const after: string[] = [];

	for (const line of patch.split(/\r?\n/u)) {
		if (line === "" || HUNK_HEADER.test(line) || FILE_HEADER.test(line))
			continue;
		if (NO_NEWLINE.test(line)) continue;

		const marker = line.slice(0, 1);
		const text = line.slice(1);

		if (marker === "+") {
			after.push(text);
			continue;
		}

		if (marker === "-") {
			before.push(text);
			continue;
		}

		if (marker === " ") {
			before.push(text);
			after.push(text);
			continue;
		}

		// A server that trimmed the leading space still means a context line.
		before.push(line);
		after.push(line);
	}

	return {
		path: file.path,
		oldText: file.newFile ? null : before.join("\n"),
		newText: after.join("\n"),
	};
}

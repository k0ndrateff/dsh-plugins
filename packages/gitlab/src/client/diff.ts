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
 * One `DiffHunk` per `@@`: concatenating every hunk would draw two changes at
 * opposite ends of a file as neighbours. The file headers and the optional
 * `diff --git` metadata are skipped only before the first hunk; after it, a line
 * whose text happens to start with `---` or `+++` is content.
 *
 * A file the patch cannot describe — a binary change, or a facet that answered
 * with statistics only — has no hunk, and the caller draws the file's header
 * without a diff under it.
 */

import type { DiffHunk } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DiffFile } from "../shared/panel";

/** `@@ -1,4 +1,6 @@`, which starts a new hunk. */
const HUNK_HEADER = /^@@/u;

/** The metadata a full `git diff` puts before the first hunk. */
const FILE_HEADER =
	/^(?:---|\+\+\+)(?:\s|$)|^(?:diff --git|index |new file mode|deleted file mode|similarity index|rename from|rename to)/u;

/** `\ No newline at end of file`, which is about the file rather than a line. */
const NO_NEWLINE = /^\\/u;

/** One hunk while it is being collected. */
interface Collected {
	readonly before: string[];
	readonly after: string[];
}

/**
 * Read one changed file's patch into the diff surface's own shape.
 * @param file - one file of the merge request's diff.
 * @returns one entry per hunk, in patch order; empty when there is no patch.
 */
export function patchToHunks(file: DiffFile): DiffHunk[] {
	const patch = file.patch;
	if (patch === undefined || patch.trim() === "") return [];

	const hunks: Collected[] = [];
	let current: Collected | undefined;
	let inHeader = true;

	for (const line of patch.split(/\r?\n/u)) {
		if (HUNK_HEADER.test(line)) {
			current = { before: [], after: [] };
			hunks.push(current);
			inHeader = false;

			continue;
		}

		if (line === "" || NO_NEWLINE.test(line)) continue;

		if (inHeader && FILE_HEADER.test(line)) continue;

		if (current === undefined) {
			current = { before: [], after: [] };
			hunks.push(current);
			inHeader = false;
		}

		const marker = line.slice(0, 1);
		const text = line.slice(1);

		if (marker === "+") {
			current.after.push(text);
			continue;
		}

		if (marker === "-") {
			current.before.push(text);
			continue;
		}

		if (marker === " ") {
			current.before.push(text);
			current.after.push(text);
			continue;
		}

		// A server that trimmed the leading space still means a context line.
		current.before.push(line);
		current.after.push(line);
	}

	return hunks
		.filter((hunk) => hunk.before.length > 0 || hunk.after.length > 0)
		.map((hunk) => ({
			path: file.path,
			oldText: file.newFile ? null : hunk.before.join("\n"),
			newText: hunk.after.join("\n"),
		}));
}

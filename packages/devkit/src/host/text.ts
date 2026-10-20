/**
 * The small text helpers the host half shares.
 */

/** A message for a caught value, whatever it is. */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The last `lines` lines of a text, with a note when lines were dropped.
 * @param text - the whole captured stream.
 * @param lines - how many trailing lines to keep.
 */
export function tailLines(text: string, lines: number): string {
	const kept = text.trimEnd().split(/\r?\n/u);
	if (kept.length <= lines) return kept.join("\n");

	const dropped = kept.length - lines;

	return [`… ${dropped} earlier lines`, ...kept.slice(-lines)].join("\n");
}

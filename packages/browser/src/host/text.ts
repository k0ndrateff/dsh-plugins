/**
 * Text helpers the runner and the tools share.
 *
 * Nothing here knows about browsers: it is the reading and the cutting that every
 * answer goes through before a model sees it.
 */

/** The reason inside an unknown thrown value, as a sentence. */
export const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Cut an answer down to what the model may read, at a line boundary.
 *
 * The reader is told what was dropped: an answer that silently ends mid-list
 * reads as a complete one, and a model that cannot tell the difference reports a
 * page as smaller than it is.
 * @param text - the whole answer.
 * @param maxBytes - the most of it the model may read.
 */
export const bound = (text: string, maxBytes: number): string => {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

	const lines = text.split("\n");
	const kept: string[] = [];
	let used = 0;

	for (const line of lines) {
		const size = Buffer.byteLength(line, "utf8") + 1;
		if (used + size > maxBytes) break;

		kept.push(line);
		used += size;
	}

	const dropped = lines.length - kept.length;

	return [
		...kept,
		`…and ${dropped} more line${dropped === 1 ? "" : "s"} (the answer was cut at ${maxBytes} bytes)`,
	].join("\n");
};

/** One JSON value as text a model can read, and a gap it can see. */
export const jsonText = (value: unknown): string => {
	if (value === undefined) return "";

	return JSON.stringify(value, undefined, 1) ?? String(value);
};

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
 * page as smaller than it is. A single line longer than the whole budget is cut
 * inside that line rather than dropped altogether — a one-line answer is still
 * an answer, and losing it would be the worse trade.
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

	if (kept.length === 0 && lines[0] !== undefined) {
		const head = cutToBytes(lines[0], Math.max(1, maxBytes - 96));

		return `${head}\n…the answer was cut at ${maxBytes} bytes`;
	}

	return [
		...kept,
		`…and ${dropped} more line${dropped === 1 ? "" : "s"} (the answer was cut at ${maxBytes} bytes)`,
	].join("\n");
};

/** The longest prefix of a text that fits in a byte budget. */
const cutToBytes = (text: string, maxBytes: number): string => {
	let cut = text.slice(0, maxBytes);

	while (cut !== "" && Buffer.byteLength(cut, "utf8") > maxBytes)
		cut = cut.slice(0, -1);

	return cut;
};

/** One JSON value as text a model can read, and a gap it can see. */
export const jsonText = (value: unknown): string => {
	if (value === undefined) return "";

	return JSON.stringify(value, undefined, 1) ?? String(value);
};

/**
 * One JSON value as compact text, so an answer costs tokens it can justify.
 *
 * Indented JSON of a request log or a tab list is mostly whitespace; the model
 * reads a compact document just as well, and a compact one is what a byte cap
 * can cut without turning the answer into unparseable prose.
 * @param value - one command's payload.
 */
export const compactJson = (value: unknown): string => {
	if (value === undefined) return "";

	return JSON.stringify(value) ?? String(value);
};

/**
 * Compact JSON within a byte budget, with an honest note when it does not fit.
 *
 * A truncated JSON document is not valid JSON, so the note says so in words
 * rather than pretending the cut list is the whole one: the model must know it
 * is looking at a fragment and ask for less.
 * @param value - one command's payload.
 * @param maxBytes - the most of its text the model may read.
 */
export const boundJson = (value: unknown, maxBytes: number): string => {
	const text = compactJson(value);

	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

	const head = cutToBytes(text, Math.max(1, maxBytes - 160));

	return `${head}\n…this JSON was cut at ${maxBytes} bytes, so the structure is incomplete: ask for fewer items or read one of them at a time.`;
};

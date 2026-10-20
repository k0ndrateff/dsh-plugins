/**
 * Turning a CI job's trace into the text a reader sees.
 *
 * GitLab sends a job log the way a terminal would receive it: escape sequences
 * between the words, and a carriage return where a progress line overwrote
 * itself. The UI kit parses escapes for its own terminal surface, but that
 * parser is not part of its public exports and a job log has no command to draw
 * — so this reads the trace the way a terminal would: escapes are consumed, a
 * carriage return starts the line over, and a newline commits it.
 *
 * The reader walks the string rather than matching it, because a regular
 * expression for escape sequences would have to spell the escape character out
 * in source.
 */

/** The escape character that begins every sequence. */
const ESCAPE = "\u001b";

/** The final byte of a control sequence: `@` through `~`. */
const isFinal = (char: string): boolean => char >= "@" && char <= "~";

/**
 * Step past one escape sequence.
 * @param text - the whole trace.
 * @param start - the index of the escape character.
 * @returns the index just after the sequence.
 */
function skipEscape(text: string, start: number): number {
	const kind = text[start + 1];

	if (kind === "[") {
		let index = start + 2;

		while (index < text.length && !isFinal(text[index] ?? "")) index += 1;

		return index + 1;
	}

	if (kind === "]") {
		let index = start + 2;

		while (index < text.length) {
			if (text[index] === "\u0007") return index + 1;
			if (text[index] === ESCAPE && text[index + 1] === "\\") return index + 2;

			index += 1;
		}

		return index;
	}

	return start + 2;
}

/**
 * Read one job's trace as display text.
 * @param text - the raw trace, escapes and all.
 * @returns the same lines without escapes, each showing its final state.
 */
export function readJobLog(text: string): string {
	const lines: string[] = [];
	let line = "";
	let index = 0;

	while (index < text.length) {
		const char = text[index] ?? "";

		if (char === ESCAPE) {
			index = skipEscape(text, index);
			continue;
		}

		if (char === "\n") {
			lines.push(line);
			line = "";
			index += 1;
			continue;
		}

		if (char === "\r") {
			// A carriage return before a newline is that newline; on its own it
			// means the next text overwrites this line, as a progress bar does.
			if (text[index + 1] === "\n") {
				lines.push(line);
				line = "";
				index += 2;
				continue;
			}

			line = "";
			index += 1;
			continue;
		}

		line += char;
		index += 1;
	}

	lines.push(line);

	return lines.join("\n");
}

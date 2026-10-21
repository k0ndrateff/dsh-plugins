/**
 * What a provider's markdown means once an integration reads it.
 *
 * Jira, Confluence and GitLab all store markdown whose HTML comments are
 * invisible where the text was written: a comment is a note to whoever edits the
 * document, not part of what it says. This harness renders that markdown in a
 * panel and hands the same string to the model, so the note is dropped where the
 * document is read rather than hidden where it is drawn — an integration's
 * reader is the one place both surfaces go through.
 *
 * Only what the document says outside its code fences is touched: an example of
 * a comment is content, and so is the whitespace inside the example. An
 * unterminated comment swallows the rest of its document, which is what an HTML
 * comment means anyway.
 */

/** A line that opens or closes a fenced code block. */
const FENCE = /^\s{0,3}(?:```|~~~)/u;

/** What a comment starts and ends with. */
const OPEN = "<!--";
const CLOSE = "-->";

/** One line, with the comments in it removed and its spacing tidied. */
interface Uncommented {
	readonly text: string;
	/** Whether this line held a comment, which is what its spacing depends on. */
	readonly touched: boolean;
}

/**
 * Remove the comments from the lines outside code fences.
 * @param lines - the document's lines.
 * @returns each line with its comments gone, and whether it held any.
 */
const uncomment = (lines: readonly string[]): Uncommented[] => {
	const kept: Uncommented[] = [];
	let inFence = false;
	let inComment = false;

	for (const line of lines) {
		if (!inComment && FENCE.test(line)) {
			inFence = !inFence;
			kept.push({ text: line, touched: false });
			continue;
		}

		if (inFence) {
			kept.push({ text: line, touched: false });
			continue;
		}

		let rest = line;
		let text = "";
		let touched = false;

		while (rest !== "") {
			if (inComment) {
				const end = rest.indexOf(CLOSE);

				// An unterminated comment runs to the end of the document.
				if (end === -1) {
					rest = "";
					break;
				}

				inComment = false;
				rest = rest.slice(end + CLOSE.length);
				continue;
			}

			const start = rest.indexOf(OPEN);

			if (start === -1) {
				text += rest;
				rest = "";
				break;
			}

			text += rest.slice(0, start);
			touched = true;
			inComment = true;
			rest = rest.slice(start + OPEN.length);
		}

		kept.push({ text, touched });
	}

	return kept;
};

/**
 * Remove the HTML comments from one markdown document.
 * @param markdown - the document as the provider stores it.
 * @returns the document without its comments; the same string when it has none.
 */
export const stripHtmlComments = (markdown: string): string => {
	if (!markdown.includes(OPEN)) return markdown;

	const kept: string[] = [];
	let inFence = false;
	/** Whether the line just kept was blank, so a run of them stays one line. */
	let blank = false;

	for (const line of uncomment(markdown.split("\n"))) {
		if (FENCE.test(line.text)) {
			inFence = !inFence;
			blank = false;
			kept.push(line.text);
			continue;
		}

		if (inFence) {
			kept.push(line.text);
			continue;
		}

		// A comment that stood as its own paragraph leaves the empty line that
		// separated it from the next one; markdown reads a run of blank lines as
		// one, so the run collapses rather than the document gaining a gap.
		if (line.text.trim() === "") {
			if (kept.length === 0 || blank) continue;

			blank = true;
			kept.push(line.text);
			continue;
		}

		blank = false;

		// Where a page renders "one two", the source reads "one <!-- x --> two" and
		// the removal would leave the two spaces both sides brought. Only a line
		// that lost a comment is touched, and only between words: two trailing
		// spaces are markdown's own way of writing a line break.
		kept.push(
			line.touched ? line.text.replace(/[ \t]{2,}(?=\S)/gu, " ") : line.text,
		);
	}

	// A blank line at the end of a document is not part of what it says, and the
	// one a trailing comment left is the reader's, not the author's.
	while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") kept.pop();

	return kept.join("\n");
};

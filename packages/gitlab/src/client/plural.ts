/**
 * One count and its noun in the right number.
 *
 * Counts end up in transcripts and card headings, where "1 merge requests" reads
 * as machine output; every surface that prints one asks this instead of spelling
 * `count === 1 ? "" : "s"` again.
 */

/**
 * One count with its noun.
 * @param count - how many there are.
 * @param one - the noun in the singular, such as "merge request".
 * @param many - the plural, when it is not just an `s`.
 */
export const countText = (
	count: number,
	one: string,
	many = `${one}s`,
): string => `${count} ${count === 1 ? one : many}`;

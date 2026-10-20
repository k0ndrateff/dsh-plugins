/**
 * One small piece of copy the panel and its tabs share.
 *
 * The reason inside an unknown thrown value, as a sentence the user can read.
 */

/** The reason inside an unknown thrown value, as a sentence. */
export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

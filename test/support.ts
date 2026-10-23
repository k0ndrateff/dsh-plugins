/**
 * The one assertion helper the suites share.
 *
 * Bun's `test` says which scenario failed; this adds the line-level label so a
 * failing check reads as the sentence it was written as. It is deliberately
 * only that: no counting, no process exit, no runner of its own.
 */
import { expect } from "bun:test";

/** Assert one labelled condition. */
export const check = (label: string, ok: boolean, detail = ""): void => {
	expect(ok, detail === "" ? label : `${label} — ${detail}`).toBe(true);
};

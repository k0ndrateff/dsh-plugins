/**
 * The fallback: the exit code is the whole answer.
 *
 * A project that runs a command nobody here can read still gets a status, a
 * duration, and the tail of what it printed — which is what makes an unknown
 * tool visible in the card instead of silently passing.
 */

import { EMPTY_SUMMARY } from "../../shared/checks";
import type { Parser } from "./parsed";

export const parseGeneric: Parser = () => ({
	summary: EMPTY_SUMMARY,
	failures: [],
});

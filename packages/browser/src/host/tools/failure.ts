/**
 * What a failed command says to the model.
 *
 * The CLI's own refusals are accurate and terse — "the command did not finish
 * within 60000ms and was stopped", "no element matches @e9" — and a model that
 * reads one of them either gives up on a transient problem or repeats a call
 * that cannot start working. This is the one place that turns a refusal into
 * the next step: retry, take a fresh snapshot, open a page, start the server,
 * or install the CLI. Nothing here retries anything itself; it only says what
 * kind of failure this is.
 */

import type { BrowserOutcome } from "../runner";

/** One kind of failure, as it is recognised in the CLI's own words. */
interface Advice {
	/** The shape of the refusal, in the CLI's vocabulary. */
	readonly match: RegExp;
	/** What the model should do next. */
	readonly next: string;
}

/** The failures worth recognising, most specific first. */
const ADVICE: readonly Advice[] = [
	{
		match: /did not finish within \d+ms/i,
		next: "The command timed out, which is usually a page that is still loading. Retry it, or wait for the page with browser_act's `wait` before calling again.",
	},
	{
		match: /the call was cancelled/i,
		next: "The call was cancelled before it finished; nothing on the page changed. Retry if the task still needs it.",
	},
	{
		match: /is not on PATH|not found on PATH/i,
		next: "The agent-browser CLI is not installed for this harness. Retrying will not help until it is installed or the Executable setting points at it.",
	},
	{
		match:
			/browser not (launched|running)|no browser (is running|to close|launched)|browser was closed|not launched/i,
		next: "There is no browser in this conversation right now. Open a page with browser_open before calling the browser again.",
	},
	{
		match:
			/no element|element .*not found|not (visible|attached)|@e\d+.*(stale|missing|no longer)|no matching element/i,
		next: "That reference is stale or missing. Take a fresh browser_snapshot and use the references it returns, then retry.",
	},
	{
		match:
			/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ENOTFOUND|ECONNREFUSED/i,
		next: "The page could not be reached. Check that the server is running and that the address is right, then retry.",
	},
	{
		match: /EACCES|permission denied|not writable/i,
		next: "The browser could not write where it needs to. Check the CLI's permissions and the plugin settings, then retry.",
	},
	{
		match: /invalid (url|scheme)|unsupported scheme|about:blank/i,
		next: "The address was refused. Open an absolute http, https, file or data URL, then retry.",
	},
];

/** The next step for one refusal, or nothing when this is not a known shape. */
export const adviceOf = (error: string): string | undefined =>
	ADVICE.find((advice) => advice.match.test(error))?.next;

/**
 * One failed outcome as the message a model reads.
 *
 * The CLI's own sentence stays first — it names what it refused — and the next
 * step is appended only when this is a failure the plugin has learnt the shape
 * of; inventing advice for an unknown refusal would be worse than being terse.
 * @param error - the CLI's own reason.
 */
export const failureText = (error: string): string => {
	const advice = adviceOf(error);

	if (advice === undefined || error.includes(advice)) return error;

	return `${error}\n${advice}`;
};

/**
 * One failed outcome, as the error a tool throws.
 * @param outcome - the failed command's answer.
 */
export const failureOf = (outcome: BrowserOutcome): Error =>
	new Error(
		failureText(
			outcome.ok
				? "the command reported success where a failure was expected"
				: outcome.error,
		),
	);

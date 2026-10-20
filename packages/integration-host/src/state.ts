/**
 * Process-local state of one integration connection.
 *
 * Everything durable — the tokens, and the account facts learned from the
 * account — lives in the credential record. This is only what a running attempt
 * and the settings card need between calls, so a restart loses nothing that
 * matters.
 */

import type { AuthorizationNotice } from "@deepseek-ai/dsh-authorization";
import type { AccountFacts } from "./facts";

/** Everything one host half keeps between calls. */
export class RuntimeState<TFacts extends AccountFacts> {
	/** The last notice a running attempt published, so a card can show the URL. */
	notice: AuthorizationNotice | undefined;
	/** The last failure, cleared when a new attempt starts. */
	error: string | undefined;
	/** Settles when the in-flight attempt finishes. */
	running: Promise<unknown> | undefined;
	/** The account facts this connection works with, once known. */
	facts: TFacts | undefined;

	constructor() {
		this.notice = undefined;
		this.error = undefined;
		this.running = undefined;
		this.facts = undefined;
	}
}

/**
 * Process-local state of one Atlassian connection.
 *
 * Everything durable — the tokens, and the site facts learned from the account
 * — lives in the credential record. This is only what a running attempt and the
 * settings card need between calls, so a restart loses nothing that matters.
 */

import type { AuthorizationNotice } from "@deepseek-ai/dsh-authorization";
import type { SiteFacts } from "./store/site";

/** Everything the host half keeps between calls. */
export class RuntimeState {
	/** The last notice a running attempt published, so a card can show the URL. */
	notice: AuthorizationNotice | undefined;
	/** The last failure, cleared when a new attempt starts. */
	error: string | undefined;
	/** Settles when the in-flight attempt finishes. */
	running: Promise<unknown> | undefined;
	/** Base URL of the Atlassian site, learned from the account after connecting. */
	siteUrl: string | undefined;
	/** Cloud id of that site; every Jira and Confluence MCP tool requires it. */
	cloudId: string | undefined;

	constructor() {
		this.notice = undefined;
		this.error = undefined;
		this.running = undefined;
		this.siteUrl = undefined;
		this.cloudId = undefined;
	}

	/** Take whatever the given facts add, keeping what is already known. */
	applySite(facts: SiteFacts): void {
		this.siteUrl = facts.siteUrl ?? this.siteUrl;
		this.cloudId = facts.cloudId ?? this.cloudId;
	}

	/** Forget the site; another account may live somewhere else. */
	forgetSite(): void {
		this.siteUrl = undefined;
		this.cloudId = undefined;
	}
}

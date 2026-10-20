/**
 * Process-local state of one Sentry connection.
 *
 * Everything durable — the tokens, and the organization facts learned from the
 * account — lives in the credential record. This is only what a running attempt
 * and the settings card need between calls, so a restart loses nothing that
 * matters.
 */

import type { AuthorizationNotice } from "@deepseek-ai/dsh-authorization";
import type { OrganizationFacts } from "./store/organization";

/** Everything the host half keeps between calls. */
export class RuntimeState {
	/** The last notice a running attempt published, so a card can show the URL. */
	notice: AuthorizationNotice | undefined;
	/** The last failure, cleared when a new attempt starts. */
	error: string | undefined;
	/** Settles when the in-flight attempt finishes. */
	running: Promise<unknown> | undefined;
	/** Slug of the organization the plugin works with. */
	organization: string | undefined;
	/** That organization's web URL, when Sentry names one. */
	organizationUrl: string | undefined;

	constructor() {
		this.notice = undefined;
		this.error = undefined;
		this.running = undefined;
		this.organization = undefined;
		this.organizationUrl = undefined;
	}

	/** Take whatever the given facts add, keeping what is already known. */
	applyOrganization(facts: Pick<OrganizationFacts, "slug" | "webUrl">): void {
		this.organization = facts.slug ?? this.organization;
		this.organizationUrl = facts.webUrl ?? this.organizationUrl;
	}

	/** Forget the organization; another account may live somewhere else. */
	forgetOrganization(): void {
		this.organization = undefined;
		this.organizationUrl = undefined;
	}
}

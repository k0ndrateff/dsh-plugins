/**
 * The status document the host half serves and the browser half renders.
 *
 * This is the second half of the two-halves wire contract: the host builds it
 * from the credential record and the open MCP connection, and the settings card
 * reads it from `/dsh-sentry/status`. Everything every integration reports comes
 * from `dsh-integration-host/status`; Sentry adds the organization it works with.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** One organization the account belongs to, as the settings card offers it. */
export interface SentryOrganizationRef {
	readonly slug: string;
	/** Base URL, when Sentry named one. */
	readonly webUrl?: string;
}

/** Everything the settings card needs to draw itself. */
export interface SentryStatus extends IntegrationStatus {
	/** The organization slug the plugin works with, once known. */
	readonly organization: string | null;
	/** That organization's web URL, when Sentry names one. */
	readonly organizationUrl: string | null;
	/** Every organization the account named, so a multi-org account can switch. */
	readonly organizations: readonly SentryOrganizationRef[];
}

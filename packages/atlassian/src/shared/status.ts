/**
 * The status document the host half serves and the browser half renders.
 *
 * This is the second half of the two-halves wire contract: the host builds it
 * from the credential record and the open MCP connection, and the settings card
 * reads it from `/dsh-atlassian/status`. Everything every integration reports
 * comes from `dsh-integration-host/status`; Atlassian adds the sites it works
 * with.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** One site the account can reach, as the settings card offers it. */
export interface AtlassianSiteRef {
	/** Base URL, without a trailing slash. */
	readonly url: string;
	/** The id every Jira and Confluence call names. */
	readonly cloudId: string;
}

/** Everything the settings card needs to draw itself. */
export interface AtlassianStatus extends IntegrationStatus {
	/** Base URL of the site the plugin works with, once known. */
	readonly siteUrl: string | null;
	/** Cloud id of the selected site, once known. */
	readonly cloudId: string | null;
	/** Every site the account named, so a multi-site account can switch. */
	readonly sites: readonly AtlassianSiteRef[];
}

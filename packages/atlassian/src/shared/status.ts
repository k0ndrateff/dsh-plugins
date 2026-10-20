/**
 * The status document the host half serves and the browser half renders.
 *
 * This is the second half of the two-halves wire contract: the host builds it
 * from the credential record and the open MCP connection, and the settings card
 * reads it from `/dsh-atlassian/status`. Everything every integration reports
 * comes from `dsh-integration-host/status`; Atlassian adds the site it works
 * with.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** Everything the settings card needs to draw itself. */
export interface AtlassianStatus extends IntegrationStatus {
	/** Base URL of the Atlassian site, once known. */
	readonly siteUrl: string | null;
}

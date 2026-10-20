/**
 * The status document the host half serves and the browser half renders.
 *
 * This is one half of the two-halves wire contract: the host builds it from the
 * credential record and the open MCP connection, and the settings card reads it
 * from `/dsh-gitlab/status`. Everything every integration reports comes from
 * `dsh-integration-host/status`; GitLab adds the account it works with.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** Everything the settings card needs to draw itself. */
export interface GitLabStatus extends IntegrationStatus {
	/** The username the token belongs to, once known. */
	readonly username: string | null;
	/** That account's full name, when GitLab names one. */
	readonly userName: string | null;
	/** That account's profile page, when GitLab names one. */
	readonly userUrl: string | null;
}

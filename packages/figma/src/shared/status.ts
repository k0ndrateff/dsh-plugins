/**
 * The status document the host half serves and the browser half renders.
 *
 * This is one half of the two-halves wire contract: the host builds it from the
 * open MCP connection, and the settings card reads it from `/dsh-figma/status`.
 * Figma adds nothing to the shared document, and that is the point: a local
 * server has no account to name, no token to expire, and no scope to report, so
 * every field the card draws already exists.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** Everything the settings card needs to draw itself. */
export type FigmaStatus = IntegrationStatus;

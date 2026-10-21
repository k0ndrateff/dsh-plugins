/**
 * The status document the digest serves and the settings card renders.
 *
 * The digest has no provider and no account: everything it reports is the
 * collection of integrations offering it blocks. That is why this adds nothing
 * to the shared document — every field the card draws already exists, and the
 * one fact worth adding, the providers, is what `tools` carries.
 */

import type { IntegrationStatus } from "dsh-integration-host/status";

export type { StatusNotice } from "dsh-integration-host/status";

/** Everything the digest's settings card needs to draw itself. */
export type DigestStatus = IntegrationStatus;

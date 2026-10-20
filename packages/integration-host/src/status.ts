/**
 * The status document every integration serves and renders.
 *
 * This is one half of the two-halves wire contract: the host builds it from the
 * credential record and the open MCP connection, and the settings card reads it
 * from the plugin's own route. A provider's own status extends this shape with
 * whatever its server names — Sentry an organization, Atlassian a site — and the
 * shared settings card draws only the part declared here.
 */

/** A one-way message to the user, mirroring the authorization seam's notice. */
export interface StatusNotice {
	readonly message: string;
	/** The page the user must open, when the message has one. */
	readonly url?: string;
}

/** Everything every settings card needs, whatever the integration. */
export interface IntegrationStatus {
	/** Whether a usable access token is stored. */
	readonly signedIn: boolean;
	/** Whether a sign-in attempt is running right now. */
	readonly inFlight: boolean;
	/** Epoch milliseconds at which the access token expires. */
	readonly expiresAt: number | null;
	/** The scope string the grant was issued with. */
	readonly scope: string | null;
	/** The last thing a running attempt told the user. */
	readonly notice: StatusNotice | null;
	/** The last failure, cleared when a new attempt starts. */
	readonly error: string | null;
	/** Whether the MCP connection is currently usable. */
	readonly connected: boolean;
	/** Public names of the published tools. */
	readonly tools: readonly string[];
	/** The MCP resource the plugin is configured to use. */
	readonly endpoint: string;
}

/**
 * The status document the host half serves and the browser half renders.
 *
 * This is the second half of the two-halves wire contract: the host builds it
 * from the credential record and the open MCP connection, and the settings card
 * reads it from `/dsh-atlassian/status`.
 */

/** A one-way message to the user, mirroring the authorization seam's notice. */
export interface StatusNotice {
	readonly message: string;
	/** The page the user must open, when the message has one. */
	readonly url?: string;
}

/** Everything the settings card needs to draw itself. */
export interface AtlassianStatus {
	/** Whether a usable access token is stored. */
	readonly signedIn: boolean;
	/** Whether a sign-in attempt is running right now. */
	readonly inFlight: boolean;
	/** Epoch milliseconds at which the access token expires. */
	readonly expiresAt: number | null;
	/** The scope string the grant was issued with. */
	readonly scope: string | null;
	/** Atlassian site base URL, once known. */
	readonly siteUrl: string | null;
	/** The last thing a running attempt told the user. */
	readonly notice: StatusNotice | null;
	/** The last failure, cleared when a new attempt starts. */
	readonly error: string | null;
	/** Whether the MCP connection is currently usable. */
	readonly connected: boolean;
	/** Public names of the published Atlassian tools. */
	readonly tools: readonly string[];
	/** The MCP resource the plugin is configured to use. */
	readonly endpoint: string;
}

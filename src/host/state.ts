/**
 * Mutable state shared by the host half's surfaces: the sign-in attempt, the
 * MCP connection, and whatever the last attempt told the user.
 *
 * Everything here is process-local. The durable facts — tokens and the site URL
 * — live in the credential record instead, so a restart loses nothing that
 * matters.
 */

import type { AuthorizationNotice } from "@deepseek-ai/dsh-authorization";
import type { Client } from "@modelcontextprotocol/client";
import type { OAuthServer } from "./oauth/server";

/** Everything the host half keeps between calls. */
export class RuntimeState {
	/** The last notice a running attempt published, so a card can show the URL. */
	notice: AuthorizationNotice | undefined;
	/** The last failure, cleared when a new attempt starts. */
	error: string | undefined;
	/** Settles when the in-flight attempt finishes. */
	running: Promise<unknown> | undefined;
	/** The open MCP connection, when there is one. */
	client: Client | undefined;
	/** Disposers for the currently published tools, keyed by public tool name. */
	tools: Map<string, () => void>;
	/** Public names of the published tools, in discovery order. */
	toolNames: string[];
	/** Whether the MCP connection is currently usable. */
	connected: boolean;
	/** The authorization server resolved for the configured endpoint. */
	oauth: OAuthServer | undefined;
	/** Atlassian site base URL, learned from the account after connecting. */
	siteUrl: string | undefined;

	constructor() {
		this.notice = undefined;
		this.error = undefined;
		this.running = undefined;
		this.client = undefined;
		this.tools = new Map();
		this.toolNames = [];
		this.connected = false;
		this.oauth = undefined;
		this.siteUrl = undefined;
	}
}

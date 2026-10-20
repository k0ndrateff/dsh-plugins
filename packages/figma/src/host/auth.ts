/**
 * Connection state and the operations that change it.
 *
 * The Figma Dev Mode MCP server runs inside the desktop app and answers whoever
 * is on the machine, so this integration has no credential: there is no browser
 * flow to start and nothing for the user to paste. What is left is the same face
 * `dsh-integration-host` serves the route and the command with — connect, report,
 * and drop — so the settings card and `/figma` read one state and cannot
 * disagree about what "connected" means.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { IntegrationAuthFace, RuntimeState } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import type { FigmaStatus } from "../shared/status";
import type { FigmaConfig } from "./config";

/** The line the command and the card show when there is nothing to sign in to. */
const NO_SIGN_IN =
	"Figma’s Dev Mode MCP server needs no sign-in: start the Figma desktop app and turn on “Enable Dev Mode MCP Server” in its preferences.";

/** Everything the auth needs, wired once at apply time. */
export interface AuthDeps {
	readonly ctx: Context;
	readonly config: FigmaConfig;
	readonly bridge: McpBridge;
	readonly state: RuntimeState;
}

export class FigmaAuth implements IntegrationAuthFace<FigmaStatus> {
	constructor(private readonly deps: AuthDeps) {}

	/**
	 * There is no browser flow to start.
	 *
	 * The settings card and `/figma login` both land here, and both answer with
	 * what the user has to start rather than pretending to open a page.
	 */
	async signIn(): Promise<unknown> {
		this.deps.state.notice = { message: NO_SIGN_IN };

		return { status: "unavailable" as const };
	}

	/** Disconnect: withdraw the published tools until the next connect. */
	async signOut(): Promise<void> {
		const { bridge, state } = this.deps;

		await bridge.drop();

		state.notice = undefined;
		state.error = undefined;
	}

	/**
	 * Reach the Dev Mode server and publish its tools.
	 * @returns whether the connection is usable.
	 */
	async connect(): Promise<boolean> {
		const { bridge, state } = this.deps;
		const ready = await bridge.ensure(this.deps.ctx);

		// The reason a connection failed is the server's own words — a desktop app
		// that is not running, a Dev Mode switch that is off — and it is what the
		// settings card must show, rather than a bare "not connected".
		state.error = ready ? undefined : bridge.lastFailure;

		if (ready) state.notice = undefined;

		return ready;
	}

	/**
	 * Build the status document for one caller.
	 *
	 * There is no credential to report, so `signedIn` answers the only question
	 * this integration can be asked: whether the local server answered, which is
	 * exactly what makes its tools usable.
	 */
	async getStatus(): Promise<FigmaStatus> {
		const { state, config, bridge } = this.deps;

		return {
			signedIn: bridge.isConnected,
			inFlight: false,
			expiresAt: null,
			scope: null,
			notice: state.notice ?? null,
			error: state.error ?? null,
			connected: bridge.isConnected,
			tools: [...bridge.toolNames],
			endpoint: config.endpoint,
		};
	}

	/** The line a sign-in request answers with. */
	loginMessage(status: FigmaStatus): string {
		return status.notice?.message ?? NO_SIGN_IN;
	}

	/** Nothing is in flight without a browser flow, so nothing is waited for. */
	async settleNotice(): Promise<void> {}
}

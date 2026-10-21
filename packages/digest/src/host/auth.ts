/**
 * What the digest reports about itself.
 *
 * There is no credential here and nothing to sign in to: a digest is assembled
 * from integrations that each own their own sign-in, and this plugin only asks
 * them questions. What is left of the shared face is the part the settings
 * route needs — a status document — so the digest answers with the thing it can
 * honestly report: which integrations are offering it blocks.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { IntegrationAuthFace } from "dsh-integration-host";
import type { DigestStatus } from "../shared/status";
import type { DigestSettingsStore } from "./settings";

/** What the digest tells a user who asks how to sign in. */
const NO_SIGN_IN =
	"The digest has no account of its own: it reads whichever integrations you have connected. Sign in to Jira, GitLab or Sentry in their own settings sections.";

/** Everything the face reports from. */
export interface AuthDeps {
	readonly ctx: Context;
	readonly settings: DigestSettingsStore;
}

export class DigestAuth implements IntegrationAuthFace<DigestStatus> {
	constructor(private readonly deps: AuthDeps) {}

	/** There is no browser flow to start. */
	async signIn(): Promise<unknown> {
		return { status: "unavailable" as const };
	}

	/** Nothing to forget: the digest holds no credential. */
	async signOut(): Promise<void> {}

	/**
	 * There is nothing to connect, so this only reports what is on offer.
	 * @returns whether any integration is offering digest blocks.
	 */
	async connect(): Promise<boolean> {
		return this.providers().length > 0;
	}

	/** Build the status document for one caller. */
	async getStatus(): Promise<DigestStatus> {
		const providers = this.providers();

		return {
			// The digest is usable the moment it is installed; what varies is how
			// much of it has anything to report.
			signedIn: true,
			inFlight: false,
			expiresAt: null,
			scope: null,
			notice: null,
			error:
				providers.length === 0
					? "No integration is offering digest blocks yet."
					: null,
			connected: providers.length > 0,
			tools: [...providers],
			endpoint: "local",
		};
	}

	/** The line a sign-in request answers with. */
	loginMessage(): string {
		return NO_SIGN_IN;
	}

	/** Nothing is in flight without a browser flow, so nothing is waited for. */
	async settleNotice(): Promise<void> {}

	/** The integrations offering blocks right now. */
	private providers(): readonly string[] {
		return this.deps.ctx.get("digestSources")?.providers ?? [];
	}
}

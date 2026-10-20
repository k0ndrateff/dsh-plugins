/**
 * Sign-in state and the operations that change it.
 *
 * One implementation serves every caller — the `/atlassian` command, the
 * settings card's HTTP calls, and the automatic connect after a successful
 * attempt — so the card and the command can never drift apart.
 *
 * The OAuth machinery itself belongs to `dsh-mcp-oauth`; this class owns what is
 * Atlassian's: which credential record is this plugin's, what the settings card
 * shows, and the site facts learned after connecting.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	type AuthorizationFlow,
	errorText,
	type GrantStore,
	loggerOf,
	type McpOAuthBridge,
	openBrowser,
} from "dsh-mcp-oauth";
import type { AtlassianStatus, StatusNotice } from "../shared/status";
import type { Config } from "./config";
import type { RuntimeState } from "./state";
import { SiteFacts } from "./store/site";

/** The tool whose answer names the account's site. */
const SITE_TOOL = "getAccessibleAtlassianResources";

export interface AuthDeps {
	readonly ctx: Context;
	readonly config: Config;
	readonly state: RuntimeState;
	readonly store: GrantStore;
	readonly flow: AuthorizationFlow;
	readonly bridge: McpOAuthBridge;
}

export class AtlassianAuth {
	constructor(private readonly deps: AuthDeps) {}

	/** Start a sign-in attempt, or join the one already running. */
	async signIn(): Promise<unknown> {
		const { ctx, state } = this.deps;

		if (state.running !== undefined) return state.running;

		state.notice = undefined;
		state.error = undefined;

		const controller = new AbortController();

		state.running = (async () => {
			try {
				const outcome = await ctx.authorization.begin({
					key: this.deps.store.credentialKey,
					signal: controller.signal,
					interaction: {
						// The flow publishes the authorize URL; opening it is the driver's
						// business, because a generic UI driving the same flow would render
						// the URL instead of launching a browser.
						notify: (notice) => {
							state.notice = notice satisfies StatusNotice;

							if (typeof notice.url === "string") openBrowser(ctx, notice.url);
						},
						prompt: () =>
							Promise.reject(new Error("Atlassian sign-in needs no prompts")),
					},
				});

				if (outcome.status === "authorized") {
					state.notice = { message: "Signed in to Atlassian." };

					await this.connect();
				} else {
					state.error = "Sign-in was cancelled.";
				}

				return outcome;
			} catch (error) {
				state.error = errorText(error);
				loggerOf(ctx).warn("[atlassian] sign-in failed: %s", state.error);

				return { status: "failed" as const };
			} finally {
				state.running = undefined;
			}
		})();

		return state.running;
	}

	/** Forget the sign-in and withdraw every published tool. */
	async signOut(): Promise<void> {
		const { ctx, state, store, bridge } = this.deps;

		try {
			ctx.authorization.cancel(store.credentialKey);
		} catch {
			// Nothing in flight; cancel is not an error here.
		}

		await bridge.drop();
		await store.clear();

		state.notice = undefined;
		state.error = undefined;
		state.forgetSite();
	}

	/**
	 * Connect, restoring the known site facts first so published tools have them.
	 * @returns whether the connection is usable.
	 */
	async connect(): Promise<boolean> {
		this.deps.state.applySite(SiteFacts.from(await this.deps.store.read()));

		const ready = await this.deps.bridge.ensure(this.deps.ctx);

		if (ready) await this.learnSite();

		return ready;
	}

	/** Build the status document for one caller. */
	async getStatus(): Promise<AtlassianStatus> {
		const { state, config, bridge, store } = this.deps;
		const grant = await store.read();
		const signedIn = grant?.isSignedIn() ?? false;
		const site = SiteFacts.from(grant);

		return {
			signedIn,
			inFlight: state.running !== undefined,
			expiresAt: signedIn ? (grant?.expiresAt ?? null) : null,
			scope: signedIn ? (grant?.scope ?? null) : null,
			siteUrl: state.siteUrl ?? site.siteUrl ?? null,
			notice: state.notice ?? null,
			error: state.error ?? null,
			connected: bridge.isConnected,
			tools: [...bridge.toolNames],
			endpoint: config.endpoint,
		};
	}

	/** The line the command and any notice show for a sign-in in progress. */
	loginMessage(status: AtlassianStatus): string {
		if (status.notice?.url !== undefined) {
			return `${status.notice.message} ${status.notice.url}`;
		}

		return (
			status.notice?.message ?? "Opening your browser to sign in to Atlassian…"
		);
	}

	/** Wait briefly so a just-started attempt can publish its authorize URL. */
	async settleNotice(ms = 400): Promise<void> {
		await new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	/** Learn the site once, and remember it for the next start. */
	private async learnSite(): Promise<void> {
		const { ctx, state, store, bridge } = this.deps;

		if (state.siteUrl !== undefined && state.cloudId !== undefined) return;
		if (!bridge.toolNames.some((name) => name.endsWith(SITE_TOOL))) return;

		try {
			const facts = SiteFacts.parse(await bridge.callTool(SITE_TOOL, {}));

			if (facts.isEmpty) return;

			state.applySite(facts);
			await store.remember({
				...(facts.siteUrl === undefined ? {} : { siteUrl: facts.siteUrl }),
				...(facts.cloudId === undefined ? {} : { cloudId: facts.cloudId }),
			});
		} catch (error) {
			loggerOf(ctx).warn(
				"[atlassian] could not read the site URL: %s",
				errorText(error),
			);
		}
	}
}

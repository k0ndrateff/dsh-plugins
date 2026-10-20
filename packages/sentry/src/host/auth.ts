/**
 * Sign-in state and the operations that change it.
 *
 * One implementation serves every caller — the `/sentry` command, the settings
 * card's HTTP calls, and the automatic connect after a successful attempt — so
 * the card and the command can never drift apart.
 *
 * The OAuth machinery itself belongs to `dsh-mcp-oauth`; this class owns what is
 * Sentry's: which credential record is this plugin's, what the settings card
 * shows, and the organization facts learned after connecting.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	type AuthorizationFlow,
	errorText,
	type GrantStore,
	loggerOf,
	type McpBridge,
	openBrowser,
} from "dsh-mcp-oauth";
import type { SentryStatus, StatusNotice } from "../shared/status";
import type { Config } from "./config";
import type { RuntimeState } from "./state";
import { ORGANIZATIONS_TOOL, OrganizationFacts } from "./store/organization";

export interface AuthDeps {
	readonly ctx: Context;
	readonly config: Config;
	readonly state: RuntimeState;
	readonly store: GrantStore;
	readonly flow: AuthorizationFlow;
	readonly bridge: McpBridge;
}

export class SentryAuth {
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
							Promise.reject(new Error("Sentry sign-in needs no prompts")),
					},
				});

				if (outcome.status === "authorized") {
					state.notice = { message: "Signed in to Sentry." };

					await this.connect();
				} else {
					state.error = "Sign-in was cancelled.";
				}

				return outcome;
			} catch (error) {
				state.error = errorText(error);
				loggerOf(ctx).warn("[sentry] sign-in failed: %s", state.error);

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
		state.forgetOrganization();
	}

	/**
	 * Connect, restoring the known organization first so published tools have it.
	 * @returns whether the connection is usable.
	 */
	async connect(): Promise<boolean> {
		this.deps.state.applyOrganization(
			OrganizationFacts.from(await this.deps.store.read()),
		);

		const ready = await this.deps.bridge.ensure(this.deps.ctx);

		if (ready) await this.learnOrganization();

		return ready;
	}

	/** Build the status document for one caller. */
	async getStatus(): Promise<SentryStatus> {
		const { state, config, bridge, store } = this.deps;
		const grant = await store.read();
		const signedIn = grant?.isSignedIn() ?? false;
		const organization = OrganizationFacts.from(grant);

		return {
			signedIn,
			inFlight: state.running !== undefined,
			expiresAt: signedIn ? (grant?.expiresAt ?? null) : null,
			scope: signedIn ? (grant?.scope ?? null) : null,
			organization: state.organization ?? organization.slug ?? null,
			organizationUrl: state.organizationUrl ?? organization.webUrl ?? null,
			notice: state.notice ?? null,
			error: state.error ?? null,
			connected: bridge.isConnected,
			tools: [...bridge.toolNames],
			endpoint: config.endpoint,
		};
	}

	/** The line the command and any notice show for a sign-in in progress. */
	loginMessage(status: SentryStatus): string {
		if (status.notice?.url !== undefined)
			return `${status.notice.message} ${status.notice.url}`;

		return (
			status.notice?.message ?? "Opening your browser to sign in to Sentry…"
		);
	}

	/** Wait briefly so a just-started attempt can publish its authorize URL. */
	async settleNotice(ms = 400): Promise<void> {
		await new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	/** Learn the organization once, and remember it for the next start. */
	private async learnOrganization(): Promise<void> {
		const { ctx, state, store, bridge } = this.deps;

		if (state.organization !== undefined && state.organizationUrl !== undefined)
			return;
		if (!bridge.toolNames.some((name) => name.endsWith(ORGANIZATIONS_TOOL)))
			return;

		try {
			const facts = OrganizationFacts.parse(
				await bridge.callTool(ORGANIZATIONS_TOOL, {}),
			);

			if (facts.isEmpty) return;

			state.applyOrganization(facts);
			await store.remember({
				...(facts.slug === undefined ? {} : { organization: facts.slug }),
				...(facts.webUrl === undefined
					? {}
					: { organizationUrl: facts.webUrl }),
			});
		} catch (error) {
			loggerOf(ctx).warn(
				"[sentry] could not read the organization: %s",
				errorText(error),
			);
		}
	}
}

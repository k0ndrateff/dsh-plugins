/**
 * Sign-in state and the operations that change it.
 *
 * One implementation serves every caller — the slash command, the settings
 * card's HTTP calls, and the automatic connect after a successful attempt — so
 * the card and the command can never drift apart. What differs between
 * integrations is only what the provider's own server names: its label, the log
 * tag, and the account facts learned after connecting.
 *
 * The OAuth machinery itself belongs to `dsh-mcp-oauth`.
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
import type { EndpointConfig } from "./config";
import type { AccountFacts, FactsReader } from "./facts";
import type { RuntimeState } from "./state";
import type { IntegrationStatus, StatusNotice } from "./status";

/** What one provider adds to the generic status document. */
export type StatusExtras<TStatus extends IntegrationStatus, TFacts> = (
	base: IntegrationStatus,
	facts: TFacts | undefined,
) => TStatus;

/** Everything that is the provider's rather than the library's. */
export interface AuthSpec<
	TStatus extends IntegrationStatus,
	TFacts extends AccountFacts,
> {
	/** The provider's name, as the user sees it. */
	readonly label: string;
	/** The log tag every message of this plugin carries, such as `[sentry]`. */
	readonly logTag: string;
	/** How this provider reads the facts its own server names. */
	readonly facts: FactsReader<TFacts>;
	/** The provider's own fields of the status document. */
	readonly status: StatusExtras<TStatus, TFacts>;
}

/** Everything the auth needs, wired once at apply time. */
export interface AuthDeps<
	TStatus extends IntegrationStatus,
	TFacts extends AccountFacts,
> {
	readonly ctx: Context;
	readonly config: EndpointConfig;
	readonly state: RuntimeState<TFacts>;
	readonly store: GrantStore;
	readonly flow: AuthorizationFlow;
	readonly bridge: McpBridge;
	readonly spec: AuthSpec<TStatus, TFacts>;
}

/** The sign-in operations every caller of an integration shares. */
export interface IntegrationAuthFace<TStatus extends IntegrationStatus> {
	signIn(): Promise<unknown>;
	signOut(): Promise<void>;
	connect(): Promise<boolean>;
	getStatus(): Promise<TStatus>;
	loginMessage(status: TStatus): string;
	settleNotice(ms?: number): Promise<void>;
}

export class IntegrationAuth<
	TStatus extends IntegrationStatus,
	TFacts extends AccountFacts,
> implements IntegrationAuthFace<TStatus>
{
	constructor(private readonly deps: AuthDeps<TStatus, TFacts>) {}

	/** Start a sign-in attempt, or join the one already running. */
	async signIn(): Promise<unknown> {
		const { ctx, state, spec } = this.deps;

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
							Promise.reject(
								new Error(`${spec.label} sign-in needs no prompts`),
							),
					},
				});

				if (outcome.status === "authorized") {
					state.notice = { message: `Signed in to ${spec.label}.` };

					await this.connect();
				} else {
					state.error = "Sign-in was cancelled.";
				}

				return outcome;
			} catch (error) {
				state.error = errorText(error);
				loggerOf(ctx).warn("%s sign-in failed: %s", spec.logTag, state.error);

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
		state.facts = undefined;
	}

	/**
	 * Connect, restoring the known account facts first so published tools have
	 * them.
	 * @returns whether the connection is usable.
	 */
	async connect(): Promise<boolean> {
		const { state, store, bridge, ctx, spec } = this.deps;

		state.facts = spec.facts.from(await store.read());

		const ready = await bridge.ensure(ctx);

		if (ready) await this.learn();

		return ready;
	}

	/** Build the status document for one caller. */
	async getStatus(): Promise<TStatus> {
		const { state, config, bridge, store, spec } = this.deps;
		const grant = await store.read();
		const signedIn = grant?.isSignedIn() ?? false;

		return spec.status(
			{
				signedIn,
				inFlight: state.running !== undefined,
				expiresAt: signedIn ? (grant?.expiresAt ?? null) : null,
				scope: signedIn ? (grant?.scope ?? null) : null,
				notice: state.notice ?? null,
				error: state.error ?? null,
				connected: bridge.isConnected,
				tools: [...bridge.toolNames],
				endpoint: config.endpoint,
			},
			state.facts ?? spec.facts.from(grant),
		);
	}

	/** The line the command and any notice show for a sign-in in progress. */
	loginMessage(status: TStatus): string {
		if (status.notice?.url !== undefined)
			return `${status.notice.message} ${status.notice.url}`;

		return (
			status.notice?.message ??
			`Opening your browser to sign in to ${this.deps.spec.label}…`
		);
	}

	/** Wait briefly so a just-started attempt can publish its authorize URL. */
	async settleNotice(ms = 400): Promise<void> {
		await new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	/** Learn the account facts once, and remember them for the next start. */
	private async learn(): Promise<void> {
		const { ctx, state, store, bridge, spec } = this.deps;
		const known = state.facts;

		if (known?.isComplete === true) return;
		if (!bridge.toolNames.some((name) => name.endsWith(spec.facts.toolName)))
			return;

		try {
			const learned = spec.facts.parse(
				await bridge.callTool(spec.facts.toolName, {}),
			);

			if (learned.isEmpty) return;

			const merged = spec.facts.merge(known, learned);

			state.facts = merged;
			await store.remember(spec.facts.remember(merged));
		} catch (error) {
			loggerOf(ctx).warn(
				"%s could not read the account facts: %s",
				spec.logTag,
				errorText(error),
			);
		}
	}
}

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

/**
 * The sentence a person can act on for a failed sign-in.
 *
 * The OAuth library's failures are precise for a log — a discovery URL, an HTTP
 * status, a timeout — and unreadable in a settings card. The common ones get a
 * sentence that names the next step; anything else keeps its own words because
 * a wrong translation is worse than a technical truth.
 */
const signInFailure = (error: unknown): string => {
	const message = errorText(error);

	if (/sign-in cancelled|operation was aborted/iu.test(message))
		return "Sign-in was cancelled.";

	if (/sign-in timed out/iu.test(message))
		return "Sign-in timed out. Try again.";

	if (/no oauth metadata|incomplete oauth metadata/iu.test(message))
		return "Could not reach the provider’s sign-in service. Check the endpoint and your network, then try again.";

	if (/authorization denied: (.+)/iu.test(message)) {
		const reason = /authorization denied: (.+)/iu.exec(message)?.[1] ?? "";

		return reason === ""
			? "The provider refused the sign-in."
			: `The provider refused the sign-in (${reason}).`;
	}

	if (/token endpoint|token exchange/iu.test(message))
		return "The provider refused the token exchange. Try signing in again.";

	return message;
};

/** The sign-in operations every caller of an integration shares. */
export interface IntegrationAuthFace<TStatus extends IntegrationStatus> {
	signIn(): Promise<unknown>;
	/**
	 * Abort the attempt that is running, when the provider has a browser flow.
	 *
	 * A provider whose credential is typed has nothing in flight; leaving this
	 * optional is what keeps the token and no-auth implementations from writing
	 * an empty method they can never use.
	 */
	cancel?(): Promise<void>;
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

		state.controller = controller;
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
				state.error = signInFailure(error);
				loggerOf(ctx).warn(
					"%s sign-in failed: %s",
					spec.logTag,
					errorText(error),
				);

				return { status: "failed" as const };
			} finally {
				state.running = undefined;
				state.controller = undefined;
			}
		})();

		return state.running;
	}

	/**
	 * Stop waiting for the browser and let the attempt settle as cancelled.
	 *
	 * The flow rejects its loopback promise on the signal, so `signIn` reaches its
	 * own catch and clears `running`; waiting for it here means the card never
	 * reports "cancelled" while the attempt is still holding the loopback port.
	 */
	async cancel(): Promise<void> {
		const { state } = this.deps;
		const controller = state.controller;

		if (controller === undefined || controller.signal.aborted) return;

		controller.abort();
		await state.running?.catch(() => undefined);
	}

	/** Forget the sign-in and withdraw every published tool. */
	async signOut(): Promise<void> {
		const { ctx, state, store, bridge } = this.deps;

		// A user who signs out while the browser flow is still open means it; stop
		// waiting for the callback before the credential and its tools go away.
		await this.cancel();

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

		if (ready) {
			state.error = undefined;
			await this.learn();
		} else {
			// The reason a connection failed is the provider's own words — a group
			// switch that is off, a scope the token lacks — and it is what the
			// settings card must show, rather than a bare "not connected".
			state.error = bridge.lastFailure;
		}

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
			return (
				`${status.notice.message}\n` +
				`If your browser did not open, visit ${status.notice.url}`
			);

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

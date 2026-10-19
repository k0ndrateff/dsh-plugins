/**
 * Sign-in state and the operations that change it.
 *
 * One implementation serves every caller — the `/atlassian` command, the
 * settings card's HTTP calls, and the automatic connect after a successful
 * attempt — so the card and the command can never drift apart.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { AtlassianStatus, StatusNotice } from "../shared/status";
import { openBrowser } from "./browser";
import type { Config } from "./config";
import { errorText, loggerOf } from "./log";
import { mcpBridge } from "./mcp/bridge";
import type { RuntimeState } from "./state";
import { Grant } from "./store/grant";

class Auth {
	/** Start a sign-in attempt, or join the one already running. */
	signIn = async (
		ctx: Context,
		state: RuntimeState,
		config: Config,
	): Promise<unknown> => {
		if (state.running !== undefined) return state.running;

		state.notice = undefined;
		state.error = undefined;

		const controller = new AbortController();
		state.running = (async () => {
			try {
				const outcome = await ctx.authorization.begin({
					key: Grant.CREDENTIAL_KEY,
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

					await mcpBridge.ensure(ctx, state, config);
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
	};

	/** Forget the sign-in and withdraw every published tool. */
	signOut = async (ctx: Context, state: RuntimeState): Promise<void> => {
		try {
			ctx.authorization.cancel(Grant.CREDENTIAL_KEY);
		} catch {
			// Nothing in flight; cancel is not an error here.
		}

		await mcpBridge.drop(state);
		await Grant.clear(ctx);

		state.oauth = undefined;
		state.siteUrl = undefined;
		state.notice = undefined;
		state.error = undefined;
	};

	/** Build the status document for one caller. */
	getStatus = async (
		ctx: Context,
		state: RuntimeState,
		config: Config,
	): Promise<AtlassianStatus> => {
		const grant = await Grant.read(ctx);
		const signedIn = grant?.isSignedIn() ?? false;

		return {
			signedIn,
			inFlight: state.running !== undefined,
			expiresAt: signedIn ? (grant?.expiresAt ?? null) : null,
			scope: signedIn ? (grant?.scope ?? null) : null,
			siteUrl: state.siteUrl ?? grant?.siteUrl ?? null,
			notice: state.notice ?? null,
			error: state.error ?? null,
			connected: state.connected,
			tools: state.toolNames,
			endpoint: config.endpoint,
		};
	};

	/** The line the command and any notice show for a sign-in in progress. */
	loginMessage = (status: AtlassianStatus): string => {
		if (status.notice?.url !== undefined) {
			return `${status.notice.message} ${status.notice.url}`;
		}

		return (
			status.notice?.message ?? "Opening your browser to sign in to Atlassian…"
		);
	};

	/** Wait briefly so a just-started attempt can publish its authorize URL. */
	settleNotice = async (ms = 400): Promise<void> => {
		await new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	};
}

export const auth = new Auth();

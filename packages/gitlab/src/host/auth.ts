/**
 * Sign-in state and the operations that change it.
 *
 * GitLab signs in with a personal access token the user pastes, not through a
 * browser, so this is the token-shaped implementation of the same face
 * `dsh-integration-host` serves the route and the command with: the settings
 * card, `/gitlab`, and the startup connection all read one state and drive one
 * set of operations, and none of them can disagree about what "connected" means.
 *
 * Saving the token belongs to the settings card's own path, because that is
 * where the user types it; everything after that is here.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { IntegrationAuthFace, RuntimeState } from "dsh-integration-host";
import { errorText, loggerOf } from "dsh-mcp-oauth";
import type { GitLabStatus } from "../shared/status";
import { type GitLabAccount, readAccount } from "./account";
import type { GitLabApi } from "./api";
import type { GitLabConfig } from "./config";
import type { TokenStore } from "./token";

/** The line the command and the card show when no token is stored. */
const NO_TOKEN =
	"GitLab signs in with a personal access token. Create one with the api scope in GitLab → Preferences → Access tokens, and paste it in the GitLab settings card.";

/** Everything the auth needs, wired once at apply time. */
export interface AuthDeps {
	readonly ctx: Context;
	readonly config: GitLabConfig;
	readonly api: GitLabApi;
	readonly token: TokenStore;
	readonly state: RuntimeState<GitLabAccount>;
}

/** The tools this plugin publishes beside the agent's own. */
const PUBLISHED_TOOLS = ["gitlab_present", "gitlab_review"];

/**
 * The sign-in face this plugin's route drives.
 *
 * Saving a token is not part of the shared face, because a browser flow has no
 * such step; it is what this integration adds to it.
 */
export interface GitLabAuthFace extends IntegrationAuthFace<GitLabStatus> {
	/**
	 * Store one pasted token and verify it.
	 * @param token - the personal access token, as the user typed it.
	 * @returns the status as it now stands, error and all.
	 */
	saveToken(token: string): Promise<GitLabStatus>;
}

export class GitLabAuth implements GitLabAuthFace {
	constructor(private readonly deps: AuthDeps) {}

	/**
	 * There is no browser flow to start: the credential is typed by the user.
	 *
	 * The settings card and `/gitlab login` both land here, and both answer with
	 * where the token goes rather than pretending to open a page.
	 */
	async signIn(): Promise<unknown> {
		this.deps.state.notice = { message: NO_TOKEN };

		return { status: "unavailable" as const };
	}

	/**
	 * Store one pasted token, then find out whether GitLab accepts it.
	 *
	 * The status is answered either way: a token GitLab refuses is a fact the
	 * card must show, not an error the request failed with.
	 */
	async saveToken(token: string): Promise<GitLabStatus> {
		const { token: store, state } = this.deps;

		await store.save(token);

		state.notice = undefined;
		state.error = undefined;
		await this.connect();

		return await this.getStatus();
	}

	/** Forget the token and everything learned with it. */
	async signOut(): Promise<void> {
		const { state, token } = this.deps;

		await token.clear();

		state.notice = undefined;
		state.error = undefined;
		state.facts = undefined;
	}

	/**
	 * Verify the stored token and learn the account it belongs to.
	 * @returns whether GitLab accepted the token.
	 */
	async connect(): Promise<boolean> {
		const { state, api, ctx, token } = this.deps;

		state.error = undefined;

		// A fresh install has no token, and that is a normal state rather than a
		// failure: the card should ask for one, not paint a red error.
		if ((await token.read()) === undefined) {
			state.facts = undefined;

			return false;
		}

		try {
			const account = await readAccount(api);

			state.facts = account;
			state.notice = undefined;

			return true;
		} catch (error) {
			state.facts = undefined;
			state.error = errorText(error);
			loggerOf(ctx).warn("[gitlab] %s", state.error);

			return false;
		}
	}

	/** Build the status document for one caller. */
	async getStatus(): Promise<GitLabStatus> {
		const { state, config, token } = this.deps;
		const stored = await token.read();
		const account = state.facts;

		return {
			signedIn: stored !== undefined,
			inFlight: false,
			expiresAt: null,
			scope: null,
			notice: state.notice ?? null,
			error: state.error ?? null,
			connected: account !== undefined && !account.isEmpty,
			tools: [...PUBLISHED_TOOLS],
			endpoint: config.endpoint,
			username: account?.username ?? null,
			userName: account?.name ?? null,
			userUrl: account?.webUrl ?? null,
		};
	}

	/** The line a sign-in request answers with. */
	loginMessage(status: GitLabStatus): string {
		return status.notice?.message ?? NO_TOKEN;
	}

	/** Nothing is in flight without a browser flow, so nothing is waited for. */
	async settleNotice(): Promise<void> {}
}

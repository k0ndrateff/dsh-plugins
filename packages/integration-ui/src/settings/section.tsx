/**
 * The shared settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 *
 * Three kinds of provider share it, and `credentials` says which one this is: a
 * browser flow, a credential the user types, or nothing at all for a server that
 * answers whoever is on the machine. The three are alternatives rather than
 * options, so the type does not let a card carry two of them.
 *
 * Everything a provider says about itself is one field of the spec, so the two
 * can never drift apart between integrations; what the provider adds — the
 * account it works with — arrives as one extra row.
 */

import {
	Button,
	Input,
	StateDot,
	Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { IntegrationStatus } from "dsh-integration-host/status";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as styles from "../styles/styles.css";

/** How often to re-read the host while an attempt is running. */
const POLL_MS = 1500;

type ConnectionState = "done" | "ongoing" | "idle";

/** The operations every settings card drives. */
export interface SettingsApi<TStatus extends IntegrationStatus> {
	/** Read the current sign-in and connection state. */
	status(): Promise<TStatus>;
	/** Start a sign-in attempt; a token card has no flow to start. */
	login?(): Promise<TStatus>;
	/** Forget the stored credential and withdraw the published tools. */
	logout(): Promise<TStatus>;
	/** Verify the stored credential and re-publish the integration's tools. */
	sync(): Promise<TStatus>;
}

/**
 * A credential the user types, for an integration with no browser flow.
 *
 * Some providers have no page to send the user to: a personal access token, a
 * client id and secret the administrator issued. The card then offers a field
 * instead of a sign-in button, and the same status document says whether what
 * was stored works.
 */
export interface TokenFieldSpec<TStatus extends IntegrationStatus> {
	/** The field's own name, such as "Personal access token". */
	readonly label: string;
	readonly placeholder: string;
	/** Where the user gets one, in one sentence. */
	readonly hint: string;
	readonly saveLabel: string;
	/** What the button that forgets the stored credential says. */
	readonly clearLabel: string;
	/**
	 * Store one typed credential and verify it.
	 * @returns the status as it now stands, error and all.
	 */
	save(token: string): Promise<TStatus>;
}

/** What every settings card says, whatever it does to connect. */
interface SectionCommon<TStatus extends IntegrationStatus> {
	readonly title: string;
	readonly blurb: string;
	/** What the card says while the first read is in flight. */
	readonly checking: string;
	/** What the card says when the host half does not answer at all. */
	readonly unreachable: string;
	readonly syncLabel: string;
	readonly api: SettingsApi<TStatus>;
	/** Rows the provider adds under the blurb, such as the account it works with. */
	readonly details?: (status: TStatus) => ReactNode;
}

/** A card whose provider signs in through a browser. */
interface BrowserSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "browser";
	readonly signInLabel: string;
	/** A browser card has no field: the two are alternatives, not options. */
	readonly token?: undefined;
	/** Its provider can start a flow, so its api must offer one. */
	readonly api: SettingsApi<TStatus> & { login(): Promise<TStatus> };
}

/** A card whose provider's credential is typed by the user. */
interface TokenSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "typed";
	readonly token: TokenFieldSpec<TStatus>;
	readonly signInLabel?: undefined;
}

/**
 * A card for a provider that needs no credential at all.
 *
 * A local MCP server answers whoever is on the machine, so there is nothing to
 * type and no page to open: the card reports what the connection is doing and
 * offers the same re-check every other card does.
 */
interface OpenSection<TStatus extends IntegrationStatus>
	extends SectionCommon<TStatus> {
	readonly credentials: "none";
	readonly signInLabel?: undefined;
	readonly token?: undefined;
}

/** Everything one integration's settings card says and does. */
export type SettingsSectionSpec<TStatus extends IntegrationStatus> =
	| BrowserSection<TStatus>
	| TokenSection<TStatus>
	| OpenSection<TStatus>;

/** Human text for the connection state, for the tooltip and the dot. */
const connectionState = (status: IntegrationStatus | null): ConnectionState => {
	if (status?.inFlight === true) return "ongoing";

	return status?.connected === true ? "done" : "idle";
};

/**
 * Build the settings section for one integration.
 * @param spec - the integration's copy, its host calls, and what it adds.
 * @returns the component the plugin registers in `settings.section`.
 */
export const createSettingsSection = <TStatus extends IntegrationStatus>(
	spec: SettingsSectionSpec<TStatus>,
): (() => ReactNode) => {
	const Section = (): ReactNode => {
		const mounted = useRef(true);

		const [status, setStatus] = useState<TStatus | null>(null);
		const [failure, setFailure] = useState<string | null>(null);
		const [busy, setBusy] = useState(false);
		const [typed, setTyped] = useState("");

		const refresh = useCallback(async () => {
			try {
				const next = await spec.api.status();

				if (!mounted.current) return;

				setStatus(next);
				setFailure(null);
			} catch (error) {
				if (!mounted.current) return;

				setStatus(null);
				setFailure(error instanceof Error ? error.message : String(error));
			}
		}, []);

		useEffect(() => {
			mounted.current = true;
			void refresh();

			return () => {
				mounted.current = false;
			};
		}, [refresh]);

		// Follow a running attempt until the host reports it settled.
		useEffect(() => {
			if (status?.inFlight !== true) return;

			const timer = setInterval(refresh, POLL_MS);

			return () => clearInterval(timer);
		}, [status?.inFlight, refresh]);

		const act = useCallback(async (action: () => Promise<TStatus>) => {
			setBusy(true);

			try {
				const next = await action();

				if (!mounted.current) return;

				setStatus(next);
				setFailure(null);
			} catch (error) {
				if (!mounted.current) return;

				setFailure(error instanceof Error ? error.message : String(error));
			} finally {
				if (mounted.current) setBusy(false);
			}
		}, []);

		// No status yet: either the first read is still in flight, or the host half
		// did not answer. Returning here is what narrows `status` for the card below.
		const tokenField = spec.token;

		if (status === null) {
			return (
				<section className={styles.section}>
					<div className={styles.card}>
						<div className={styles.head}>
							<span className={styles.title}>{spec.title}</span>
						</div>

						<div className={styles.caption}>
							{failure === null ? spec.checking : spec.unreachable}
						</div>

						{failure === null ? null : (
							<div className={styles.code}>{failure}</div>
						)}

						<div className={styles.actions}>
							<Button variant="outline" onClick={refresh}>
								Reconnect
							</Button>
						</div>
					</div>
				</section>
			);
		}

		const signedIn = status.signedIn === true;
		const toolCount = status.tools.length;
		// A card for a server that needs no credential has no token to expire, and
		// says so by never showing the line rather than by showing an empty one.
		const expiry =
			signedIn && spec.credentials !== "none" ? status.expiresAt : null;

		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>{spec.title}</span>

						<span className={styles.badges}>
							<StateDot state={connectionState(status)} />

							{spec.credentials === "none" ? (
								<Tag tone={status.connected ? "success" : "neutral"}>
									{status.connected ? "Connected" : "Not connected"}
								</Tag>
							) : (
								<Tag tone={signedIn ? "success" : "neutral"}>
									{signedIn ? "Signed in" : "Not signed in"}
								</Tag>
							)}

							{toolCount > 0 ? (
								<Tag tone="info">{`${toolCount} tool${toolCount === 1 ? "" : "s"} available`}</Tag>
							) : null}
						</span>
					</div>

					<div className={styles.caption}>{spec.blurb}</div>

					{spec.details?.(status)}

					{status.inFlight === true ? (
						<div className={styles.row}>
							<StateDot state="ongoing" />

							<span className={styles.caption}>
								Waiting for you to approve the sign-in in your browser…
							</span>
						</div>
					) : null}

					{status.notice?.url !== undefined ? (
						<div className={styles.row}>
							<span className={styles.caption}>{status.notice.message}</span>

							<a
								className={styles.link}
								href={status.notice.url}
								target="_blank"
								rel="noreferrer"
							>
								Open the sign-in page
							</a>
						</div>
					) : null}

					{status.error != null ? (
						<div className={styles.row}>
							<span className={styles.error}>{status.error}</span>
						</div>
					) : null}

					{expiry === null ? null : (
						<div className={styles.caption}>
							Token valid until {new Date(expiry).toLocaleString()}
						</div>
					)}

					{tokenField === undefined ? null : (
						<>
							<div className={styles.row}>
								<Input
									type="password"
									value={typed}
									placeholder={tokenField.placeholder}
									aria-label={tokenField.label}
									disabled={busy}
									onChange={(event) => {
										setTyped(event.target.value);
									}}
								/>
							</div>

							<div className={styles.caption}>{tokenField.hint}</div>
						</>
					)}

					<div className={styles.actions}>
						{spec.credentials === "browser" ? (
							signedIn ? (
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => void act(spec.api.logout)}
								>
									Sign out
								</Button>
							) : (
								<Button
									variant="primary"
									disabled={busy}
									onClick={() => void act(spec.api.login)}
								>
									{busy ? "Working…" : spec.signInLabel}
								</Button>
							)
						) : null}

						{spec.credentials === "typed" ? (
							<>
								<Button
									variant="primary"
									disabled={busy || typed.trim() === ""}
									onClick={() => {
										void act(async () => {
											const next = await spec.token.save(typed);

											setTyped("");

											return next;
										});
									}}
								>
									{busy ? "Working…" : spec.token.saveLabel}
								</Button>

								{signedIn ? (
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => void act(spec.api.logout)}
									>
										{spec.token.clearLabel}
									</Button>
								) : null}
							</>
						) : null}

						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => void act(spec.api.sync)}
						>
							{spec.syncLabel}
						</Button>
					</div>
				</div>
			</section>
		);
	};

	return Section;
};

/**
 * The shared settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 *
 * Everything a provider says about itself is one field of the spec, so the two
 * can never drift apart between integrations; what the provider adds — the
 * account it works with — arrives as one extra row.
 */

import { Button, StateDot, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import type { IntegrationStatus } from "dsh-integration-host/status";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as styles from "../styles/styles.css";

/** How often to re-read the host while an attempt is running. */
const POLL_MS = 1500;

type ConnectionState = "done" | "ongoing" | "idle";

/** The four operations every settings card drives. */
export interface SettingsApi<TStatus extends IntegrationStatus> {
	/** Read the current sign-in and connection state. */
	status(): Promise<TStatus>;
	/** Start a sign-in attempt; resolves as soon as the attempt is running. */
	login(): Promise<TStatus>;
	/** Forget the stored sign-in and withdraw the published tools. */
	logout(): Promise<TStatus>;
	/** Reconnect and re-publish the integration's tools. */
	sync(): Promise<TStatus>;
}

/** Everything one integration's settings card says and does. */
export interface SettingsSectionSpec<TStatus extends IntegrationStatus> {
	readonly title: string;
	readonly blurb: string;
	/** What the card says while the first read is in flight. */
	readonly checking: string;
	/** What the card says when the host half does not answer at all. */
	readonly unreachable: string;
	readonly signInLabel: string;
	readonly syncLabel: string;
	readonly api: SettingsApi<TStatus>;
	/** Rows the provider adds under the blurb, such as the account it works with. */
	readonly details?: (status: TStatus) => ReactNode;
}

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

		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>{spec.title}</span>

						<span className={styles.badges}>
							<StateDot state={connectionState(status)} />

							<Tag tone={signedIn ? "success" : "neutral"}>
								{signedIn ? "Signed in" : "Not signed in"}
							</Tag>

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

					{signedIn && status.expiresAt !== null ? (
						<div className={styles.caption}>
							Token valid until {new Date(status.expiresAt).toLocaleString()}
						</div>
					) : null}

					<div className={styles.actions}>
						{signedIn ? (
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
						)}

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

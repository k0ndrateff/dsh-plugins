/**
 * The Atlassian settings section.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 */

import { Button, StateDot, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AtlassianStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** How often to re-read the host while an attempt is running. */
const POLL_MS = 1500;

type ConnectionState = "done" | "ongoing" | "idle";

/** Human text for the connection state, for the tooltip and the dot. */
const getConnectionState = (
	status: AtlassianStatus | null,
): ConnectionState => {
	if (status?.inFlight === true) return "ongoing";

	return status?.connected === true ? "done" : "idle";
};

/** The Atlassian settings card. */
export const AtlassianSection = () => {
	const mounted = useRef(true);

	const [status, setStatus] = useState<AtlassianStatus | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const next = await hostApi.getStatus();

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

	const act = useCallback(async (action: () => Promise<AtlassianStatus>) => {
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

	if (failure !== null && status === null) {
		return (
			<section className={styles.section}>
				<div className={styles.card}>
					<div className={styles.head}>
						<span className={styles.title}>Atlassian</span>
					</div>

					<div className={styles.caption}>
						The Atlassian host half is not reachable.
					</div>

					<div className={styles.code}>{failure}</div>

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
	const toolCount = status.tools.length ?? 0;

	return (
		<section className={styles.section}>
			<div className={styles.card}>
				<div className={styles.head}>
					<span className={styles.title}>Atlassian</span>

					<span className={styles.badges}>
						<StateDot state={getConnectionState(status)} />

						<Tag tone={signedIn ? "success" : "neutral"}>
							{signedIn ? "Signed in" : "Not signed in"}
						</Tag>

						{toolCount > 0 ? (
							<Tag tone="info">{`${toolCount} tool${toolCount === 1 ? "" : "s"} available`}</Tag>
						) : null}
					</span>
				</div>

				<div className={styles.caption}>
					Jira and Confluence, through Atlassian’s MCP server.
				</div>

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
							onClick={() => void act(hostApi.signOut)}
						>
							Sign out
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={busy}
							onClick={() => void act(hostApi.startSignIn)}
						>
							{busy ? "Working…" : "Sign in with Atlassian"}
						</Button>
					)}

					<Button
						variant="ghost"
						disabled={busy}
						onClick={() => void act(hostApi.syncTools)}
					>
						Reconnect
					</Button>
				</div>
			</div>
		</section>
	);
};

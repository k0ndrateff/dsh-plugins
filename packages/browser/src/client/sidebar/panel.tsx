/**
 * The browser panel: one session's viewport, live.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to watch arrives in the
 * tab's navigation parameters, and everything after that arrives by asking the
 * host: the page's title and address, which frame to draw, what the agent did,
 * and whatever the host refuses.
 *
 * Frames are event-driven rather than a stream, so the picture is the newest one
 * the host has and may be older than it looks; the activity beside it is what
 * says whether anything is happening at all. Before the first frame the panel
 * says which of the two waits it is in — no browser yet, or a browser that has
 * not painted — because those send the reader to different places.
 */

import { Button, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { useState } from "react";
import { frameUrl } from "../../shared/panel";
import { sessionNameOf } from "../../shared/session";
import * as styles from "../styles/styles.css";
import { type CloseAnswer, closeBrowser } from "./close";
import { asBrowserTabParams } from "./definition";
import { feedLines } from "./feed";
import { type BrowserPanelState, useBrowserPanel } from "./stream";

/** How many of the host's activity items the panel shows. */
const ACTIVITY_SHOWN = 12;

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The page's name, or what the panel is still waiting for. */
const headingOf = (panel: BrowserPanelState): string => {
	const snapshot = panel.snapshot;

	if (snapshot === undefined) return "Waiting for the browser";

	return snapshot.title === "" ? "Untitled page" : snapshot.title;
};

/** What stands in the frame's place before there is one. */
const waitingFor = (panel: BrowserPanelState): string => {
	if (panel.snapshot?.connected !== true)
		return "No live browser for this session yet. It opens when the agent calls browser_open.";

	return "Waiting for the first frame.";
};

/** One session's viewport: its page, its frame, its activity, and its two actions. */
const BrowserView = ({ session }: { readonly session: string }): ReactNode => {
	const panel = useBrowserPanel(session);
	const [notice, setNotice] = useState<CloseAnswer | undefined>(undefined);
	const [isClosing, setIsClosing] = useState(false);

	const snapshot = panel.snapshot;
	const url = snapshot?.url ?? "";
	const connected = snapshot?.connected === true;
	const feed = feedLines(snapshot?.activity ?? []).slice(-ACTIVITY_SHOWN);
	const failure = panel.error ?? snapshot?.error;
	const [failedSeq, setFailedSeq] = useState<number | null>(null);

	const close = (): void => {
		setIsClosing(true);

		closeBrowser(session)
			.then(setNotice)
			.catch((error: unknown) => {
				setNotice({
					text: `The close request did not reach the host: ${messageOf(error)}`,
					isError: true,
				});
			})
			.finally(() => {
				setIsClosing(false);
			});
	};

	return (
		<div className={styles.viewer}>
			<header className={styles.viewerHead}>
				<div className={styles.viewerTitleRow}>
					<h2 className={styles.viewerTitle}>{headingOf(panel)}</h2>

					<span className={styles.viewerState}>
						<StateDot state={connected ? "done" : "idle"} />

						{connected ? "Live" : "Not connected"}
					</span>
				</div>

				{url === "" ? null : <span className={styles.viewerUrl}>{url}</span>}
			</header>

			<div className={styles.viewerScroll}>
				<div className={styles.stage}>
					{snapshot === undefined || snapshot.seq === 0 ? (
						<span className={styles.placeholder}>{waitingFor(panel)}</span>
					) : failedSeq === snapshot.seq ? (
						<span className={styles.frameMissing}>
							The frame the host has could not be shown.
						</span>
					) : (
						<img
							className={styles.frame}
							src={frameUrl(session, snapshot.seq)}
							alt={`The browser's viewport on ${headingOf(panel)}`}
							onError={() => setFailedSeq(snapshot.seq)}
						/>
					)}
				</div>

				{failure === undefined ? null : (
					<p className={`${styles.answer} ${styles.answerError}`}>{failure}</p>
				)}

				{feed.length === 0 ? null : (
					<section className={styles.activity}>
						<span className={styles.activityTitle}>Activity</span>

						<ul className={styles.activityList}>
							{feed.map((line, index) => (
								<li key={`${line.at}-${index}`} className={styles.activityItem}>
									<span className={styles.activityLabel}>{line.label}</span>

									{line.detail === "" ? null : (
										<code className={styles.activityDetail}>{line.detail}</code>
									)}

									{line.durationMs === undefined ? null : (
										<span className={styles.activityDuration}>
											{line.durationMs}ms
										</span>
									)}
								</li>
							))}
						</ul>
					</section>
				)}
			</div>

			<footer className={styles.footer}>
				<Button
					size="sm"
					disabled={url === ""}
					onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
				>
					Open in a new tab
				</Button>

				<Button
					size="sm"
					variant="outline"
					disabled={isClosing}
					onClick={close}
				>
					Close browser
				</Button>

				{notice === undefined ? null : (
					<span
						className={
							notice.isError
								? `${styles.answer} ${styles.answerError}`
								: styles.answer
						}
					>
						{notice.text}
					</span>
				)}
			</footer>
		</div>
	);
};

/** The panel's body seat: a live viewport, or the reason there is none. */
export const BrowserPanel = (
	props: PropsRuntime<"sidebar.right.pane.tab">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const params = asBrowserTabParams(tab.navigation.params);

	// A body of a session's pane always knows the session it belongs to, which is
	// what makes the panel openable from anywhere: an icon, a restored tab, or a
	// tool call that named the browser exactly.
	const session = params?.session ?? sessionNameOf(props.sessionId);

	return <BrowserView session={session} />;
};

/** The panel's title seat: the address it is on, until it has one. */
export const BrowserPanelTitle = (
	props: PropsRuntime<"sidebar.right.pane.tab.title">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const params = asBrowserTabParams(tab.navigation.params);

	return params?.url ?? tab.title;
};

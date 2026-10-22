/**
 * The browser panel: one session's viewport, live.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to watch arrives in the
 * tab's navigation parameters, and everything after that arrives over the
 * socket: the page's title and address, the last frame, what the agent did, and
 * whatever the host refuses.
 *
 * Frames are event-driven rather than a stream, so the picture is the newest one
 * the host sent and may be older than it looks; the activity beside it is what
 * says whether anything is happening at all. Before the first frame the panel
 * says which of the two waits it is in — no browser yet, or a browser that has
 * not painted — because those send the reader to different places.
 */

import { Button, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { useState } from "react";
import * as styles from "../styles/styles.css";
import { type CloseAnswer, closeBrowser } from "./close";
import { asBrowserTabParams } from "./definition";
import { type BrowserStream, useBrowserStream } from "./stream";

/** How many of the host's activity items the panel shows. */
const ACTIVITY_SHOWN = 12;

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The page's name, or what the panel is still waiting for. */
const headingOf = (stream: BrowserStream): string => {
	if (stream.state === undefined) return "Waiting for the browser";

	return stream.state.title === "" ? "Untitled page" : stream.state.title;
};

/** What stands in the frame's place before there is one. */
const waitingFor = (stream: BrowserStream): string => {
	if (stream.state?.connected !== true)
		return "No live browser for this session yet. It opens when the agent calls browser_open.";

	return "Waiting for the first frame.";
};

/** One session's viewport: its page, its frame, its activity, and its two actions. */
const BrowserView = ({ session }: { readonly session: string }): ReactNode => {
	const stream = useBrowserStream(session);
	const [notice, setNotice] = useState<CloseAnswer | undefined>(undefined);
	const [isClosing, setIsClosing] = useState(false);

	const url = stream.state?.url ?? "";
	const connected = stream.state?.connected === true;
	const activity = stream.activity.slice(-ACTIVITY_SHOWN);

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
					<h2 className={styles.viewerTitle}>{headingOf(stream)}</h2>

					<span className={styles.viewerState}>
						<StateDot state={connected ? "done" : "idle"} />

						{connected ? "Live" : "Not connected"}
					</span>
				</div>

				{url === "" ? null : <span className={styles.viewerUrl}>{url}</span>}
			</header>

			<div className={styles.viewerScroll}>
				<div className={styles.stage}>
					{stream.frame === undefined ? (
						<span className={styles.placeholder}>{waitingFor(stream)}</span>
					) : (
						<img
							className={styles.frame}
							src={`data:image/jpeg;base64,${stream.frame.data}`}
							alt={`The browser's viewport on ${headingOf(stream)}`}
						/>
					)}
				</div>

				{stream.error === undefined ? null : (
					<p className={`${styles.answer} ${styles.answerError}`}>
						{stream.error}
					</p>
				)}

				{activity.length === 0 ? null : (
					<section className={styles.activity}>
						<span className={styles.activityTitle}>Activity</span>

						<ul className={styles.activityList}>
							{activity.map((item, index) => (
								<li
									key={`${item.at}-${index}`}
									className={styles.activityItem}
									data-kind={item.kind}
								>
									{item.text}
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

	if (params === undefined)
		return (
			<div className={styles.empty}>
				This panel is opened from a browser_open tool call; it cannot guess
				which browser to watch.
			</div>
		);

	return <BrowserView session={params.session} />;
};

/** The panel's title seat: the address it is on, until it has one. */
export const BrowserPanelTitle = (
	props: PropsRuntime<"sidebar.right.pane.tab.title">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const params = asBrowserTabParams(tab.navigation.params);

	return params?.url ?? tab.title;
};

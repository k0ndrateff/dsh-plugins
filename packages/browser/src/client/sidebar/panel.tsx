/**
 * The browser panel: one session's viewport, live.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to watch arrives in the
 * tab's navigation parameters, and everything after that arrives by asking the
 * host: the page's title and address, which frame to draw, what the agent did,
 * and whatever the host refuses.
 *
 * The picture is also the person's way in. A click on it is measured against the
 * page's own size and sent as one act, a wheel is collected into one message per
 * gesture, and the keys go where the page's would — which is what makes a
 * screenshot something a person can take over rather than only watch. The three
 * buttons above the picture are the navigations the page cannot perform for
 * itself from a picture.
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
import type {
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { frameUrl, type PanelInput } from "../../shared/panel";
import { sessionNameOf } from "../../shared/session";
import * as styles from "../styles/styles.css";
import { type CloseAnswer, closeBrowser } from "./close";
import { asBrowserTabParams } from "./definition";
import { feedLines } from "./feed";
import {
	buttonOf,
	modifiersOf,
	pagePointOf,
	sendInput,
	WheelCoalescer,
} from "./input";
import { type BrowserPanelState, useBrowserPanel } from "./stream";

/** How many of the host's activity items the panel shows. */
const ACTIVITY_SHOWN = 12;

/** How often a hover over the picture is forwarded, at most. */
const HOVER_MS = 60;

/**
 * The page sizes a person can ask for.
 *
 * The picture is the whole page scaled into a sidebar, so a narrow layout is
 * what a phone actually gets: these are the three widths a UI is checked in, and
 * the picker names them by what they are rather than by their numbers alone.
 */
const PAGE_SIZES: readonly {
	readonly label: string;
	readonly width: number;
	readonly height: number;
}[] = [
	{ label: "Desktop 1280×720", width: 1_280, height: 720 },
	{ label: "Laptop 1024×768", width: 1_024, height: 768 },
	{ label: "Phone 390×844", width: 390, height: 844 },
];

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

/** One session's viewport: its page, its picture, its activity, and its actions. */
const BrowserView = ({ session }: { readonly session: string }): ReactNode => {
	const panel = useBrowserPanel(session);
	const refresh = panel.refresh;
	const [notice, setNotice] = useState<CloseAnswer | undefined>(undefined);
	const [isClosing, setIsClosing] = useState(false);
	const [failedSeq, setFailedSeq] = useState<number | null>(null);

	const stage = useRef<HTMLDivElement | null>(null);
	const picture = useRef<HTMLImageElement | null>(null);
	const hoveredAt = useRef(0);

	const snapshot = panel.snapshot;
	const url = snapshot?.url ?? "";
	const connected = snapshot?.connected === true;
	const page = snapshot?.page;
	const feed = feedLines(snapshot?.activity ?? []).slice(-ACTIVITY_SHOWN);
	const failure = panel.error ?? snapshot?.error;

	// The picker shows the page's own size: one of the three, or what the agent
	// left it at, so a person can see that the layout they are looking at is not
	// the one they picked.
	const preset = PAGE_SIZES.findIndex(
		(size) => size.width === page?.width && size.height === page?.height,
	);
	const sizeKey = preset === -1 ? "custom" : String(preset);

	const act = useCallback(
		(input: PanelInput): void => {
			sendInput(session, input)
				.then((answer) =>
					setNotice(
						answer.ok
							? undefined
							: {
									text: answer.text ?? "The host refused that action.",
									isError: true,
								},
					),
				)
				.catch((error: unknown) => {
					setNotice({
						text: `That did not reach the host: ${messageOf(error)}`,
						isError: true,
					});
				})
				.finally(refresh);
		},
		[session, refresh],
	);

	// One collector for the whole panel: a gesture's deltas are summed before a
	// message is sent, so a trackpad's scroll is a couple of requests, not sixty.
	const wheels = useMemo(() => new WheelCoalescer(act), [act]);

	// The two numbers, not the object: a poll brings a new page object every
	// quarter second, and rebinding the wheel listener that often would cut one
	// gesture into slices.
	const pageWidth = page?.width ?? 0;
	const pageHeight = page?.height ?? 0;

	const pointOf = useCallback(
		(event: { readonly clientX: number; readonly clientY: number }) => {
			const image = picture.current;

			if (image === null) return undefined;

			return pagePointOf(event, image.getBoundingClientRect(), image, {
				width: pageWidth,
				height: pageHeight,
			});
		},
		[pageWidth, pageHeight],
	);

	useEffect(() => {
		const element = stage.current;

		if (element === null) return;

		const onWheel = (event: WheelEvent): void => {
			const point = pointOf(event);

			if (point === undefined) return;

			// The picture is the page: the wheel belongs to it, not to the panel
			// that happens to be holding it.
			event.preventDefault();
			wheels.add(point, event.deltaX, event.deltaY);
		};

		element.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", onWheel);
			wheels.flush();
		};
	}, [pointOf, wheels]);

	const press = (event: ReactMouseEvent<HTMLDivElement>): void => {
		// Focus follows the click into the page, so the keys a person types next
		// land there rather than on the harness around the panel.
		event.preventDefault();
		event.currentTarget.focus();

		const point = pointOf(event);

		if (point === undefined) return;

		act({
			type: "mouse",
			event: "click",
			x: point.x,
			y: point.y,
			button: buttonOf(event.button),
			modifiers: modifiersOf(event),
		});
	};

	const hover = (event: ReactMouseEvent<HTMLDivElement>): void => {
		const now = Date.now();

		if (now - hoveredAt.current < HOVER_MS) return;

		hoveredAt.current = now;

		const point = pointOf(event);

		if (point === undefined) return;

		act({
			type: "mouse",
			event: "move",
			x: point.x,
			y: point.y,
			button: "left",
			modifiers: modifiersOf(event),
		});
	};

	const key = (
		event: ReactKeyboardEvent<HTMLDivElement>,
		isDown: boolean,
	): void => {
		event.preventDefault();

		act({
			type: "key",
			event: isDown ? "down" : "up",
			key: event.key,
			code: event.code,
			modifiers: modifiersOf(event),
		});

		// Escape is the way out of the page: the page gets it, and so does the
		// panel, so a person is never trapped in a focused picture.
		if (isDown && event.key === "Escape") event.currentTarget.blur();
	};

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

				<div className={styles.viewerNavRow}>
					<Button
						size="sm"
						variant="ghost"
						title="Back"
						aria-label="Back"
						disabled={!connected}
						onClick={() => act({ type: "navigate", to: "back" })}
					>
						←
					</Button>

					<Button
						size="sm"
						variant="ghost"
						title="Forward"
						aria-label="Forward"
						disabled={!connected}
						onClick={() => act({ type: "navigate", to: "forward" })}
					>
						→
					</Button>

					<Button
						size="sm"
						variant="ghost"
						title="Reload"
						aria-label="Reload"
						disabled={!connected}
						onClick={() => act({ type: "navigate", to: "reload" })}
					>
						↻
					</Button>

					{url === "" ? null : (
						<span className={styles.viewerAddress}>{url}</span>
					)}
				</div>
			</header>

			<div className={styles.viewerScroll}>
				<div className={styles.stage} ref={stage}>
					{snapshot === undefined || snapshot.seq === 0 ? (
						<span className={styles.placeholder}>{waitingFor(panel)}</span>
					) : failedSeq === snapshot.seq ? (
						<span className={styles.frameMissing}>
							The frame the host has could not be shown.
						</span>
					) : (
						<div
							className={styles.surface}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: the picture is the page, and focus is how it receives keys
							tabIndex={0}
							role="application"
							aria-label={`The browser's viewport on ${headingOf(panel)}`}
							onMouseDown={press}
							onMouseMove={hover}
							onKeyDown={(event) => key(event, true)}
							onKeyUp={(event) => key(event, false)}
						>
							<img
								ref={picture}
								className={styles.frame}
								src={frameUrl(session, snapshot.seq)}
								alt={`The browser's viewport on ${headingOf(panel)}`}
								draggable={false}
								onError={() => setFailedSeq(snapshot.seq)}
							/>
						</div>
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
				<select
					className={styles.pageSize}
					aria-label="Page size"
					title="The size the page is laid out at"
					disabled={!connected}
					value={sizeKey}
					onChange={(event) => {
						const size = PAGE_SIZES[Number(event.target.value)];

						if (size !== undefined)
							act({
								type: "viewport",
								width: size.width,
								height: size.height,
							});
					}}
				>
					{sizeKey === "custom" ? (
						<option value="custom" disabled>
							{page === undefined || page.width === 0
								? "Page size"
								: `Page ${page.width}×${page.height}`}
						</option>
					) : null}

					{PAGE_SIZES.map((size, index) => (
						<option key={size.label} value={String(index)}>
							{size.label}
						</option>
					))}
				</select>

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

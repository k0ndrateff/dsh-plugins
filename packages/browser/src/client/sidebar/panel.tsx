/**
 * The browser panel: one session's viewport, live.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to watch arrives in the
 * tab's navigation parameters, and everything after that arrives by asking the
 * host: the page's title and address, which frame to draw, what the agent did,
 * and how the browser is doing.
 *
 * A browser that is not on screen right now is the normal case, not a fault:
 * not opened yet, closed, paused while nobody looked, and reconnecting each have
 * their own neutral sentence, and only a real connection failure is red. The
 * person is never asked to fix a browser that is merely closed.
 *
 * The picture is also the person's way in. A click on it is measured against the
 * page's own size and sent as the press and release the page expects, so a drag
 * selects text and a double click works; a wheel is collected into one message
 * per gesture; keys go where the page's would. Because the picture swallows
 * keystrokes, there is an explicit keyboard mode: in it Tab belongs to the page,
 * and Escape is always the way back to the harness.
 *
 * Frames are event-driven rather than a stream, so the picture is the newest one
 * the host has and may be older than it looks; the activity beside it says
 * whether anything is happening, and a paused live view keeps both instead of
 * making a person forget what happened.
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
import {
	frameUrl,
	type PanelInput,
	type PanelPhase,
	type PanelSnapshot,
} from "../../shared/panel";
import { sessionNameOf } from "../../shared/session";
import * as styles from "../styles/styles.css";
import { type CloseAnswer, closeBrowser } from "./close";
import { asBrowserTabParams } from "./definition";
import { feedLines } from "./feed";
import {
	buttonOf,
	MoveCoalescer,
	modifiersOf,
	type PagePoint,
	pagePointOf,
	requestRetry,
	sendInput,
	WheelCoalescer,
} from "./input";
import { type BrowserPanelState, useBrowserPanel } from "./stream";
import { readPageText } from "./text";

/** How many of the host's activity items the panel shows. */
const ACTIVITY_SHOWN = 12;

/** How close two presses must be, and how soon, to be a double click. */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_SLOP = 2;

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

/** No modifier keys held, as a synthetic event reports them. */
const NO_MODIFIERS = { alt: false, ctrl: false, meta: false, shift: false };

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** What a phase reads as in the small state line. */
const STATE_WORD: Readonly<Record<PanelPhase, string>> = {
	none: "Not open",
	starting: "Connecting…",
	live: "Live",
	closed: "Closed",
	paused: "Paused",
	unreachable: "Not connected",
};

/** What the connection indicator dot says. */
const dotOf = (
	snapshot: PanelSnapshot | undefined,
): "done" | "idle" | "warning" | "error" => {
	if (snapshot === undefined) return "idle";
	if (snapshot.phase === "unreachable") return "error";
	if (snapshot.phase === "live") return "done";

	return "idle";
};

/** The page's name, or what the panel is still waiting for. */
const headingOf = (panel: BrowserPanelState): string => {
	const snapshot = panel.snapshot;

	if (snapshot === undefined) return "Waiting for the browser";
	if (snapshot.title !== "") return snapshot.title;
	if (snapshot.phase === "live" || snapshot.phase === "paused")
		return "Untitled page";
	if (snapshot.phase === "closed") return "Browser closed";

	return "No page open";
};

/** What stands in the frame's place before there is one. */
const waitingFor = (panel: BrowserPanelState): string => {
	const snapshot = panel.snapshot;

	if (snapshot === undefined) return "Waiting for the host…";

	switch (snapshot.phase) {
		case "closed":
			return snapshot.message;
		case "none":
			return snapshot.message;
		case "starting":
			return snapshot.message === ""
				? "Connecting to the browser…"
				: snapshot.message;
		case "unreachable":
			return "The live view could not connect to the browser.";
		case "paused":
			return "The live view is paused; the last picture is below.";
		case "live":
			return "Waiting for the first frame.";
	}
};

/** One session's viewport: its page, its picture, its activity, and its actions. */
const BrowserView = ({
	session,
	visible,
}: {
	readonly session: string;
	readonly visible: boolean;
}): ReactNode => {
	const panel = useBrowserPanel(session, visible);
	const refresh = panel.refresh;
	const [notice, setNotice] = useState<CloseAnswer | undefined>(undefined);
	const [isClosing, setIsClosing] = useState(false);
	const [failedSeq, setFailedSeq] = useState<number | null>(null);
	const [frameAttempt, setFrameAttempt] = useState(0);
	const [hintHidden, setHintHidden] = useState(false);
	const [keyboardMode, setKeyboardMode] = useState(false);
	const [textMode, setTextMode] = useState(false);
	const [pageText, setPageText] = useState<string | undefined>(undefined);
	const [textError, setTextError] = useState<string | undefined>(undefined);
	const [textLoading, setTextLoading] = useState(false);

	const stage = useRef<HTMLDivElement | null>(null);
	const picture = useRef<HTMLImageElement | null>(null);
	const drag = useRef<
		{ readonly point: PagePoint; readonly clickCount: number } | undefined
	>(undefined);
	const lastClick = useRef<
		| { readonly at: number; readonly point: PagePoint; readonly count: number }
		| undefined
	>(undefined);
	const feedBox = useRef<HTMLUListElement | null>(null);

	const snapshot = panel.snapshot;
	const phase: PanelPhase = snapshot?.phase ?? "none";
	const url = snapshot?.url ?? "";
	const title = snapshot?.title ?? "";
	const tabs = snapshot?.tabs ?? [];
	const connected = snapshot?.connected === true;
	const open = snapshot?.open === true;
	const page = snapshot?.page;
	const feed = feedLines(snapshot?.activity ?? []).slice(-ACTIVITY_SHOWN);
	const failure = snapshot?.error ?? panel.error;
	const retryable = snapshot?.retryable === true;

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
				.then((answer) => {
					if (answer.ok) {
						setHintHidden(true);

						return;
					}

					setNotice({
						text: answer.text ?? "The host refused that action.",
						isError: true,
					});
				})
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

	// Dragging across the picture is how text is selected: the pointer reports a
	// position per pixel, so they are collected the same way a wheel's are.
	const moves = useMemo(
		() =>
			new MoveCoalescer((point) =>
				act({
					type: "mouse",
					event: "move",
					x: point.x,
					y: point.y,
					button: "left",
					modifiers: NO_MODIFIERS,
				}),
			),
		[act],
	);

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

			// Only a wheel over the page is the page's: over the strip beside a
			// narrower layout the panel scrolls as it normally would.
			event.preventDefault();
			wheels.add(point, event.deltaX, event.deltaY);
		};

		element.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", onWheel);
			wheels.flush();
			moves.flush();
		};
	}, [pointOf, wheels, moves]);

	// New activity scrolls its own list, not the whole panel: the picture stays
	// where it is and the newest lines are the ones a person sees.
	useEffect(() => {
		const box = feedBox.current;

		if (box !== null) box.scrollTop = box.scrollHeight;
	}, [feed.length]);

	const loadText = useCallback((): void => {
		setTextLoading(true);
		readPageText(session)
			.then((answer) => {
				setPageText(answer.text);
				setTextError(answer.error);
			})
			.catch((error: unknown) => setTextError(messageOf(error)))
			.finally(() => setTextLoading(false));
	}, [session]);

	useEffect(() => {
		if (textMode) loadText();
	}, [textMode, loadText]);

	const press = (event: ReactMouseEvent<HTMLDivElement>): void => {
		// Focus follows the pointer into the page, so the keys a person types next
		// land there rather than on the harness around the panel.
		event.preventDefault();
		event.currentTarget.focus();

		const point = pointOf(event);

		if (point === undefined) {
			setNotice({ text: "That point is outside the page.", isError: false });

			return;
		}

		const now = Date.now();
		const previous = lastClick.current;
		const count =
			previous !== undefined &&
			now - previous.at <= DOUBLE_CLICK_MS &&
			Math.abs(previous.point.x - point.x) <= DOUBLE_CLICK_SLOP &&
			Math.abs(previous.point.y - point.y) <= DOUBLE_CLICK_SLOP
				? Math.min(2, previous.count + 1)
				: 1;

		lastClick.current = { at: now, point, count };
		drag.current = { point, clickCount: count };

		// The press is sent on its own, so a drag selects text on the page; the
		// release completes it, and the click is the two of them.
		act({
			type: "mouse",
			event: "down",
			x: point.x,
			y: point.y,
			button: buttonOf(event.button),
			clickCount: count,
			modifiers: modifiersOf(event),
		});
	};

	const release = (event: ReactMouseEvent<HTMLDivElement>): void => {
		const started = drag.current;

		drag.current = undefined;
		moves.flush();

		if (started === undefined) return;

		const released = pointOf(event);
		const point = released ?? started.point;

		if (released === undefined)
			setNotice({ text: "That point is outside the page.", isError: false });

		act({
			type: "mouse",
			event: "up",
			x: point.x,
			y: point.y,
			button: buttonOf(event.button),
			clickCount: started.clickCount,
			modifiers: modifiersOf(event),
		});
	};

	const dragOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
		if (drag.current === undefined) return;

		const point = pointOf(event);

		if (point !== undefined) moves.move(point);
	};

	const key = (
		event: ReactKeyboardEvent<HTMLDivElement>,
		isDown: boolean,
	): void => {
		// Tab belongs to the harness unless keyboard mode is on: a keyboard user
		// must always be able to leave the picture.
		if (event.key === "Tab" && !keyboardMode) return;

		event.preventDefault();

		act({
			type: "key",
			event: isDown ? "down" : "up",
			key: event.key,
			code: event.code,
			modifiers: modifiersOf(event),
		});

		// Escape is the way out of the page in both modes: the page gets it, and
		// the focus returns to the harness, so a person is never trapped.
		if (isDown && event.key === "Escape") {
			setKeyboardMode(false);
			event.currentTarget.blur();
		}
	};

	const close = (): void => {
		setIsClosing(true);

		closeBrowser(session)
			.then((answer) => {
				// A close that worked is the host's state, not a sentence: the next
				// poll moves the panel into "closed" and there is nothing to fix.
				setNotice(answer.isError ? answer : undefined);
				refresh();
			})
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

	const retry = (): void => {
		setNotice(undefined);

		requestRetry(session)
			.then((answer) => {
				if (!answer.ok)
					setNotice({
						text: answer.text ?? "The host refused the retry.",
						isError: true,
					});
			})
			.catch((error: unknown) => {
				setNotice({
					text: `The retry did not reach the host: ${messageOf(error)}`,
					isError: true,
				});
			})
			.finally(refresh);
	};

	const copy = (text: string): void => {
		if (navigator.clipboard === undefined) {
			setNotice({ text: "This page cannot use the clipboard.", isError: true });

			return;
		}

		navigator.clipboard
			.writeText(text)
			.then(() => setNotice({ text: "Copied the address.", isError: false }))
			.catch(() =>
				setNotice({ text: "The address could not be copied.", isError: true }),
			);
	};

	// What a screen reader hears when the panel changes: the state, and the
	// newest thing that happened, without reading the whole feed.
	const newest = feed.at(-1);
	const announcement = [
		STATE_WORD[phase],
		newest === undefined
			? ""
			: `${newest.label}${newest.detail === "" ? "" : ` ${newest.detail}`}`,
	]
		.filter((part) => part !== "")
		.join(". ");
	const tabNames = tabs
		.map(
			(tab) =>
				`${tab.active ? "• " : ""}${tab.title === "" ? tab.url : tab.title}`,
		)
		.join("\n");

	return (
		<div className={styles.viewer}>
			<header className={styles.viewerHead}>
				<div className={styles.viewerTitleRow}>
					<h2
						className={styles.viewerTitle}
						title={title === "" ? undefined : title}
					>
						{headingOf(panel)}
					</h2>

					{tabs.length > 1 ? (
						<span className={styles.viewerTabs} title={tabNames}>
							{tabs.length} tabs
						</span>
					) : null}

					<span className={styles.viewerState} role="status" aria-live="polite">
						<StateDot state={dotOf(snapshot)} />
						{STATE_WORD[phase]}
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
						<>
							<span className={styles.viewerAddress} title={url}>
								{url}
							</span>

							<Button
								size="sm"
								variant="ghost"
								title="Copy the address"
								aria-label="Copy the address"
								onClick={() => copy(url)}
							>
								⧉
							</Button>
						</>
					)}
				</div>
			</header>

			<div className={styles.viewerScroll}>
				<div className={styles.hintBar}>
					{hintHidden ? null : (
						<span className={styles.hintText}>
							{keyboardMode
								? "Keyboard goes to the page. Escape returns to the panel."
								: "Click and type into the page; Escape leaves it."}
						</span>
					)}

					<Button
						size="sm"
						variant={keyboardMode ? "primary" : "ghost"}
						aria-pressed={keyboardMode}
						onClick={() => setKeyboardMode((on) => !on)}
					>
						Keyboard to page
					</Button>

					<Button
						size="sm"
						variant={textMode ? "primary" : "ghost"}
						aria-pressed={textMode}
						onClick={() => setTextMode((on) => !on)}
					>
						{textMode ? "Picture" : "Text"}
					</Button>

					{textMode ? (
						<Button
							size="sm"
							variant="ghost"
							disabled={textLoading}
							onClick={loadText}
						>
							{textLoading ? "Reading…" : "Refresh text"}
						</Button>
					) : null}

					{hintHidden ? null : (
						<Button
							size="sm"
							variant="ghost"
							aria-label="Hide this hint"
							title="Hide this hint"
							onClick={() => setHintHidden(true)}
						>
							×
						</Button>
					)}
				</div>

				{textMode ? (
					<pre className={styles.pageText} aria-live="polite">
						{textLoading
							? "Reading the page…"
							: (textError ?? pageText ?? "No text yet.")}
					</pre>
				) : (
					<div className={styles.stage} ref={stage}>
						{snapshot === undefined || snapshot.seq === 0 ? (
							<span className={styles.placeholder}>{waitingFor(panel)}</span>
						) : failedSeq === snapshot.seq ? (
							<div className={styles.frameMissing}>
								<span>The frame the host has could not be shown.</span>

								<Button
									size="sm"
									onClick={() => {
										setFailedSeq(null);
										setFrameAttempt((attempt) => attempt + 1);
									}}
								>
									Try again
								</Button>
							</div>
						) : (
							<div
								className={styles.surface}
								// biome-ignore lint/a11y/noNoninteractiveTabindex: the picture is the page, and focus is how it receives keys
								tabIndex={0}
								role="application"
								aria-label={`The browser's viewport on ${headingOf(panel)}. Click and type into it; Escape leaves it.`}
								onMouseDown={press}
								onMouseUp={release}
								onMouseMove={dragOver}
								onKeyDown={(event) => key(event, true)}
								onKeyUp={(event) => key(event, false)}
							>
								<img
									ref={picture}
									className={styles.frame}
									src={`${frameUrl(session, snapshot.seq)}&r=${String(frameAttempt)}`}
									alt={`The browser's viewport on ${headingOf(panel)}`}
									draggable={false}
									onError={() => setFailedSeq(snapshot.seq)}
								/>
							</div>
						)}
					</div>
				)}

				{snapshot === undefined ||
				phase === "live" ||
				snapshot.message === "" ||
				snapshot.seq === 0 ? null : (
					<p className={styles.answer}>{snapshot.message}</p>
				)}

				{snapshot?.retryable === true && failure === undefined ? (
					<div className={styles.failureRow}>
						<Button size="sm" onClick={retry}>
							Retry
						</Button>
					</div>
				) : null}

				{failure === undefined ? null : (
					<div className={styles.failureRow} role="alert">
						<p className={`${styles.answer} ${styles.answerError}`}>
							{failure}
						</p>

						{retryable ? (
							<Button size="sm" onClick={retry}>
								Retry
							</Button>
						) : null}
					</div>
				)}

				{feed.length === 0 ? null : (
					<section className={styles.activity}>
						<span className={styles.activityTitle}>Activity</span>

						<ul className={styles.activityList} ref={feedBox}>
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
					disabled={!connected || !open}
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
					disabled={!open || isClosing}
					onClick={close}
				>
					Close browser
				</Button>

				{notice === undefined ? null : (
					<span
						role={notice.isError ? "alert" : "status"}
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

			<div className={styles.srOnly} role="status" aria-live="polite">
				{announcement}
			</div>
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

	return <BrowserView session={session} visible={tab.visible} />;
};

/** The panel's title seat: the address it is on, until it has one. */
export const BrowserPanelTitle = (
	props: PropsRuntime<"sidebar.right.pane.tab.title">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const params = asBrowserTabParams(tab.navigation.params);

	return params?.url ?? tab.title;
};

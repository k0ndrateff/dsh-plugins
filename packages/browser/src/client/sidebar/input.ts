/**
 * The person's side of the live view: their click, their wheel, their keys.
 *
 * The panel draws a picture of a page that lives in another process, so a click
 * here is not a click on a document — it is a measurement. Where in the picture
 * it happened is read against the picture's own box, translated into the page's
 * coordinates, and sent as one request. Everything in this file is arithmetic on
 * numbers a browser handed over, which is why it can be checked without one.
 *
 * A wheel is the one act that arrives in bulk: a trackpad reports dozens of
 * deltas for one gesture, so they are collected and sent as one message every
 * few thousandths of a second rather than dropped.
 */

import { isRecord } from "dsh-integration-host/shape";
import {
	CLIENT_REQUEST_HEADER,
	CLIENT_REQUEST_VALUE,
} from "dsh-integration-host/status";
import {
	inputUrl,
	type PanelInput,
	type PanelModifiers,
	type PanelPage,
	retryUrl,
} from "../../shared/panel";
import { hostWord, parseAnswer } from "./answer";

/** What the host said about one act, and whether it says the act did not happen. */
export interface InputAnswer {
	/** The host's own words, when it sent any. */
	readonly text: string | undefined;
	/** Whether the host refused, or answered with a failure status. */
	readonly ok: boolean;
}

/** Whether the host's own answer is a refusal, whatever status carried it. */
const isRefusal = (value: unknown): boolean =>
	isRecord(value) && value.ok === false;

/** Send one POST to a write route and read its answer. */
const post = async (url: string, body: unknown): Promise<InputAnswer> => {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			[CLIENT_REQUEST_HEADER]: CLIENT_REQUEST_VALUE,
		},
		body: JSON.stringify(body),
	});

	const text = (await response.text()).trim();
	const parsed = parseAnswer(text);

	return {
		text: hostWord(parsed) ?? (text === "" ? undefined : text),
		ok: response.ok && !isRefusal(parsed),
	};
};

/**
 * Send one act to the host.
 *
 * A transport failure rejects rather than answering, so the caller can tell "the
 * host said no" from "the host was not reached".
 * @param session - the browser session the act belongs to.
 * @param input - what the person did.
 * @returns the host's answer, with whether it reports a failure.
 */
export const sendInput = (session: string, input: PanelInput) =>
	post(inputUrl(session), input);

/**
 * Ask the host to connect to this session's browser again.
 *
 * The retry budget is spent after three failed attempts, and then nothing but a
 * tool call used to restart it. The person watching the panel needs their own
 * way back: this is the click behind Retry.
 * @param session - the browser session to reconnect.
 */
export const requestRetry = (session: string) => post(retryUrl(session), {});

/** A box in the page's own pixels, as an element measures itself. */
export interface ScreenBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** A point in the page's own pixels. */
export interface PagePoint {
	readonly x: number;
	readonly y: number;
}

/** The size a picture decoded to, which is what the sidebar scales down. */
export interface Picture {
	readonly naturalWidth: number;
	readonly naturalHeight: number;
}

/**
 * Where in the page a point in the picture landed.
 *
 * The picture is the page fitted into the browser window's surface — scaled by
 * one factor on both axes and anchored at its top-left — so the surface can be
 * larger than the page and the leftover is not the page at all. The mapping is
 * therefore: the clicked point, in the picture's own pixels, divided by the
 * factor the fit used.
 *
 * A click on the leftover is not a click on the page, and is refused rather than
 * clamped: a strip beside a phone layout is not the phone's right edge.
 * @param point - a pointer event's position in the window.
 * @param box - the picture's own box in the window.
 * @param picture - the size the picture decoded to.
 * @param page - the page's own size, as the browser reported it.
 * @returns the page's coordinates, or undefined when the point is not on the page.
 */
export const pagePointOf = (
	point: { readonly clientX: number; readonly clientY: number },
	box: ScreenBox,
	picture: Picture,
	page: PanelPage,
): PagePoint | undefined => {
	if (box.width <= 0 || box.height <= 0) return undefined;
	if (picture.naturalWidth <= 0 || picture.naturalHeight <= 0) return undefined;
	if (page.width <= 0 || page.height <= 0) return undefined;

	const scale = Math.min(
		picture.naturalWidth / page.width,
		picture.naturalHeight / page.height,
	);
	const x = ((point.clientX - box.left) / box.width) * picture.naturalWidth;
	const y = ((point.clientY - box.top) / box.height) * picture.naturalHeight;

	if (x < 0 || y < 0) return undefined;
	if (x > page.width * scale || y > page.height * scale) return undefined;

	return {
		x: Math.min(Math.floor(x / scale), page.width - 1),
		y: Math.min(Math.floor(y / scale), page.height - 1),
	};
};

/** Which buttons were held, as the page's own event would report them. */
export const modifiersOf = (event: {
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}): PanelModifiers => ({
	alt: event.altKey,
	ctrl: event.ctrlKey,
	meta: event.metaKey,
	shift: event.shiftKey,
});

/** The button a pointer event names, in the page's own words. */
export const buttonOf = (button: number): "left" | "right" | "middle" =>
	button === 1 ? "middle" : button === 2 ? "right" : "left";

/** One wheel gesture, as it is being collected. */
interface WheelBurst {
	x: number;
	y: number;
	deltaX: number;
	deltaY: number;
}

/** How long a wheel's deltas are collected before they are sent. */
const WHEEL_INTERVAL_MS = 40;

/**
 * Collects one wheel gesture's deltas into one message.
 *
 * A trackpad reports a gesture in dozens of small deltas; sending each one would
 * be a request per frame of the person's scroll. Summing them over a few tens of
 * milliseconds sends the same movement in a couple of messages and keeps the page
 * scrolling by the amount the hand actually moved.
 */
export class WheelCoalescer {
	private burst: WheelBurst | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** @param send - where a collected gesture goes. */
	constructor(private readonly send: (input: PanelInput) => void) {}

	/**
	 * Add one wheel delta.
	 * @param point - where the pointer is, in the page's pixels.
	 * @param deltaX - this event's horizontal movement.
	 * @param deltaY - this event's vertical movement.
	 */
	add(point: PagePoint, deltaX: number, deltaY: number): void {
		const burst = this.burst;

		this.burst =
			burst === undefined
				? { x: point.x, y: point.y, deltaX, deltaY }
				: {
						x: point.x,
						y: point.y,
						deltaX: burst.deltaX + deltaX,
						deltaY: burst.deltaY + deltaY,
					};

		if (this.timer !== undefined) return;

		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, WHEEL_INTERVAL_MS);
	}

	/** Send whatever has been collected, and stop waiting. */
	flush(): void {
		const burst = this.burst;

		this.burst = undefined;

		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}

		if (burst !== undefined) this.send({ type: "wheel", ...burst });
	}
}

/** How long a drag's pointer moves are collected before they are sent. */
const MOVE_INTERVAL_MS = 40;

/**
 * Collects one drag's pointer positions into timed moves.
 *
 * Dragging across the picture to select text reports a pointer position per
 * pixel; a request per pixel would be a burst of hundreds. One move every few
 * tens of milliseconds is the same gesture with a fraction of the traffic, and
 * the page selects exactly the text the hand covered.
 */
export class MoveCoalescer {
	private point: PagePoint | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** @param send - where one collected position goes. */
	constructor(private readonly send: (point: PagePoint) => void) {}

	/** Add the pointer's newest position. */
	move(point: PagePoint): void {
		this.point = point;

		if (this.timer !== undefined) return;

		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, MOVE_INTERVAL_MS);
	}

	/** Send whatever position is waiting. */
	flush(): void {
		const point = this.point;

		this.point = undefined;

		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}

		if (point !== undefined) this.send(point);
	}
}

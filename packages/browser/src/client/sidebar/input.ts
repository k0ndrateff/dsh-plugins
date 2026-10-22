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

import {
	inputUrl,
	type PanelInput,
	type PanelModifiers,
	type PanelViewport,
} from "../../shared/panel";

/** What the host said about one act, and whether it says the act did not happen. */
export interface InputAnswer {
	/** The host's own words, when it sent any. */
	readonly text: string | undefined;
	/** Whether the host refused, or answered with a failure status. */
	readonly ok: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const parse = (text: string): unknown => {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

/** The sentence inside a host answer, when it carries one. */
const hostWord = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;

	for (const key of ["error", "message"]) {
		const text = value[key];
		if (typeof text === "string" && text !== "") return text;
	}

	return undefined;
};

/** Whether the host's own answer is a refusal, whatever status carried it. */
const isRefusal = (value: unknown): boolean =>
	isRecord(value) && value.ok === false;

/**
 * Send one act to the host.
 *
 * A transport failure rejects rather than answering, so the caller can tell "the
 * host said no" from "the host was not reached".
 * @param session - the browser session the act belongs to.
 * @param input - what the person did.
 * @returns the host's answer, with whether it reports a failure.
 */
export const sendInput = async (
	session: string,
	input: PanelInput,
): Promise<InputAnswer> => {
	const response = await fetch(inputUrl(session), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(input),
	});

	const body = (await response.text()).trim();
	const parsed = parse(body);

	return {
		text: hostWord(parsed) ?? (body === "" ? undefined : body),
		ok: response.ok && !isRefusal(parsed),
	};
};

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

/**
 * Where in the page a point in the picture landed.
 *
 * The picture is the whole viewport scaled to whatever width the sidebar has, so
 * the mapping is the ratio between the two boxes. A point outside the picture
 * is clamped to the edge rather than dropped: a drag that leaves the picture
 * should still be a click at its border, which is what the page would have seen.
 * @param point - a pointer event's position in the window.
 * @param box - the picture's own box in the window.
 * @param viewport - the page's size, as the last frame reported it.
 * @returns the page's coordinates, or undefined when there is nothing to measure.
 */
export const viewportPointOf = (
	point: { readonly clientX: number; readonly clientY: number },
	box: ScreenBox,
	viewport: PanelViewport,
): PagePoint | undefined => {
	if (box.width <= 0 || box.height <= 0) return undefined;
	if (viewport.width <= 0 || viewport.height <= 0) return undefined;

	const x = ((point.clientX - box.left) / box.width) * viewport.width;
	const y = ((point.clientY - box.top) / box.height) * viewport.height;

	return {
		x: Math.min(Math.max(Math.round(x), 0), viewport.width - 1),
		y: Math.min(Math.max(Math.round(y), 0), viewport.height - 1),
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

/**
 * One input from the panel, read rather than trusted.
 *
 * The panel is this plugin's own page half, but what arrives on a route is a
 * body someone typed, so every field is checked before the browser sees it: a
 * coordinate has to be a number the page could contain, a key a name the page
 * could be given, and anything else is refused with a sentence saying why. This
 * is also the only place that decides what a `modifiers` block costs on the wire,
 * so the client half never has to know the browser's bitmask.
 */

import type { PanelInput, PanelModifiers } from "../../shared/panel";

/** The largest coordinate a frame may name, in CSS pixels. */
const MAX_COORDINATE = 100_000;

/** The largest wheel delta one event may carry. */
const MAX_DELTA = 20_000;

/** The longest key name the panel may send. */
const MAX_KEY_LENGTH = 64;

/** The smallest and largest viewport a panel may ask the page for. */
const MIN_VIEWPORT = 200;
const MAX_VIEWPORT = 3_840;

/** What one body was read as. */
export type InputReading =
	| { readonly ok: true; readonly input: PanelInput }
	| { readonly ok: false; readonly reason: string };

const refused = (reason: string): InputReading => ({ ok: false, reason });

/** One value, when it is a plain object. */
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** One value, when it is a finite number inside a range. */
const numberIn = (
	value: unknown,
	low: number,
	high: number,
): number | undefined =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= low &&
	value <= high
		? value
		: undefined;

/** One value, when it is a non-empty string no longer than a key name. */
const nameOf = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" && value.length <= MAX_KEY_LENGTH
		? value
		: undefined;

/** Whether one value is a mouse button this plugin forwards. */
const isButton = (value: unknown): value is "left" | "right" | "middle" =>
	value === "left" || value === "right" || value === "middle";

/** One flag of a modifiers block, absent meaning not held. */
const flagOf = (value: unknown): boolean => value === true;

/** A modifiers block, with every missing flag read as not held. */
const modifiersOf = (value: unknown): PanelModifiers => {
	const record = recordOf(value);

	return {
		alt: flagOf(record?.alt),
		ctrl: flagOf(record?.ctrl),
		meta: flagOf(record?.meta),
		shift: flagOf(record?.shift),
	};
};

/** The two coordinates every pointer event carries. */
const pointOf = (
	body: Record<string, unknown>,
): { readonly x: number; readonly y: number } | undefined => {
	const x = numberIn(body.x, 0, MAX_COORDINATE);
	const y = numberIn(body.y, 0, MAX_COORDINATE);

	return x === undefined || y === undefined ? undefined : { x, y };
};

/** One mouse event, as the page will receive it. */
const readMouse = (body: Record<string, unknown>): InputReading => {
	const point = pointOf(body);

	if (point === undefined) return refused("a mouse event needs an x and a y");

	const event = body.event;
	if (
		event !== "click" &&
		event !== "down" &&
		event !== "up" &&
		event !== "move"
	)
		return refused("that is not a mouse event");

	const button = body.button;
	if (!isButton(button)) return refused("that is not a mouse button");

	return {
		ok: true,
		input: {
			type: "mouse",
			event,
			x: point.x,
			y: point.y,
			button,
			modifiers: modifiersOf(body.modifiers),
		},
	};
};

/** One wheel event, as the page will receive it. */
const readWheel = (body: Record<string, unknown>): InputReading => {
	const point = pointOf(body);

	if (point === undefined) return refused("a wheel event needs an x and a y");

	const deltaX = numberIn(body.deltaX, -MAX_DELTA, MAX_DELTA) ?? 0;
	const deltaY = numberIn(body.deltaY, -MAX_DELTA, MAX_DELTA) ?? 0;

	return {
		ok: true,
		input: { type: "wheel", x: point.x, y: point.y, deltaX, deltaY },
	};
};

/** One key event, as the page will receive it. */
const readKey = (body: Record<string, unknown>): InputReading => {
	const event = body.event;

	if (event !== "down" && event !== "up")
		return refused("that is not a key event");

	const key = nameOf(body.key);

	if (key === undefined) return refused("a key event needs a key");

	return {
		ok: true,
		input: {
			type: "key",
			event,
			key,
			code: nameOf(body.code) ?? "",
			modifiers: modifiersOf(body.modifiers),
		},
	};
};

/** One navigation the panel's own buttons ask for. */
const readNavigate = (body: Record<string, unknown>): InputReading => {
	const to = body.to;

	return to === "back" || to === "forward" || to === "reload"
		? { ok: true, input: { type: "navigate", to } }
		: refused("that is not a direction the page can take");
};

/** One viewport the panel's own picker asks for. */
const readViewport = (body: Record<string, unknown>): InputReading => {
	const width = numberIn(body.width, MIN_VIEWPORT, MAX_VIEWPORT);
	const height = numberIn(body.height, MIN_VIEWPORT, MAX_VIEWPORT);

	return width === undefined || height === undefined
		? refused("a viewport is a width and a height a page could have")
		: { ok: true, input: { type: "viewport", width, height } };
};

/**
 * Read a request body as one input.
 * @param value - the parsed JSON body.
 * @returns the input, or the reason it is not one.
 */
export const readPanelInput = (value: unknown): InputReading => {
	const body = recordOf(value);

	if (body === undefined) return refused("an input is a JSON object");

	switch (body.type) {
		case "mouse":
			return readMouse(body);
		case "wheel":
			return readWheel(body);
		case "key":
			return readKey(body);
		case "navigate":
			return readNavigate(body);
		case "viewport":
			return readViewport(body);
		default:
			return refused("that is not an input this panel sends");
	}
};

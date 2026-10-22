/**
 * A person's click, spelled the way the screencast accepts it.
 *
 * The stream's client side speaks CDP's own words: an event name, a button, a
 * click count, a Windows virtual key code and a bitmask of held modifiers. None
 * of that belongs in a panel, so it is built here, once, and the panel says only
 * what a person did. A whole click becomes the press and the release the page
 * expects, because a click is one act and the pair is an implementation detail.
 */

import type { PanelInput, PanelModifiers } from "../../shared/panel";

/** One message the screencast accepts from its client. */
export type WireMessage = Readonly<Record<string, unknown>>;

/** The modifier bits the browser's key and mouse events carry. */
const MODIFIER_BITS: Readonly<Record<keyof PanelModifiers, number>> = {
	alt: 1,
	ctrl: 2,
	meta: 4,
	shift: 8,
};

/** The text a named key inserts when it is pressed, if it inserts any. */
const KEY_TEXT: Readonly<Record<string, string>> = {
	Enter: "\r",
	Tab: "\t",
	Backspace: "\b",
};

/** The virtual key codes of the keys that are not a single character. */
const KEY_CODES: Readonly<Record<string, number>> = {
	Backspace: 8,
	Tab: 9,
	Enter: 13,
	Shift: 16,
	Control: 17,
	Alt: 18,
	CapsLock: 20,
	Escape: 27,
	" ": 32,
	PageUp: 33,
	PageDown: 34,
	End: 35,
	Home: 36,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Insert: 45,
	Delete: 46,
	F1: 112,
	F2: 113,
	F3: 114,
	F4: 115,
	F5: 116,
	F6: 117,
	F7: 118,
	F8: 119,
	F9: 120,
	F10: 121,
	F11: 122,
	F12: 123,
};

/** The bitmask the browser wants for the buttons that were held. */
const bitsOf = (modifiers: PanelModifiers): number =>
	(Object.keys(MODIFIER_BITS) as readonly (keyof PanelModifiers)[]).reduce(
		(bits, name) => bits | (modifiers[name] ? MODIFIER_BITS[name] : 0),
		0,
	);

/**
 * The code the page's own key event carries.
 *
 * A letter is reported by its capital, which is the code the browser itself uses
 * for the key rather than the shift state it was pressed in; without that,
 * `Control+a` would arrive as an unnamed key.
 */
const codeOf = (key: string): number => {
	if (key.length === 1) return key.toUpperCase().charCodeAt(0);

	return KEY_CODES[key] ?? 0;
};

/** The text a key press inserts, when it inserts one. */
const textOf = (key: string): string | undefined =>
	key.length === 1 ? key : KEY_TEXT[key];

/** One mouse event, as the screencast wants it. */
const mouseEvent = (
	eventType: string,
	input: Extract<PanelInput, { readonly type: "mouse" }>,
	clickCount: number,
): WireMessage => ({
	type: "input_mouse",
	eventType,
	x: Math.round(input.x),
	y: Math.round(input.y),
	button: input.button,
	clickCount,
	modifiers: bitsOf(input.modifiers),
});

/** One key event, as the screencast wants it. */
const keyEvent = (
	eventType: string,
	input: Extract<PanelInput, { readonly type: "key" }>,
): WireMessage => ({
	type: "input_keyboard",
	eventType,
	key: input.key,
	code: input.code,
	text: eventType === "keyDown" ? textOf(input.key) : undefined,
	windowsVirtualKeyCode: codeOf(input.key),
	modifiers: bitsOf(input.modifiers),
});

/**
 * The messages one input becomes.
 * @param input - what a person did in the panel.
 * @returns the messages for the screencast, in the order it must receive them.
 */
export const wireMessagesOf = (input: PanelInput): readonly WireMessage[] => {
	switch (input.type) {
		case "mouse":
			switch (input.event) {
				case "click":
					return [
						mouseEvent("mousePressed", input, 1),
						mouseEvent("mouseReleased", input, 1),
					];
				case "down":
					return [mouseEvent("mousePressed", input, 1)];
				case "up":
					return [mouseEvent("mouseReleased", input, 1)];
				case "move":
					return [mouseEvent("mouseMoved", input, 0)];
			}

			return [];

		case "wheel":
			return [
				{
					type: "input_mouse",
					eventType: "mouseWheel",
					x: Math.round(input.x),
					y: Math.round(input.y),
					button: "none",
					clickCount: 0,
					deltaX: Math.round(input.deltaX),
					deltaY: Math.round(input.deltaY),
					modifiers: 0,
				},
			];

		case "key":
			return [keyEvent(input.event === "down" ? "keyDown" : "keyUp", input)];

		case "navigate":
		case "viewport":
			// Going back and resizing are CLI commands, not page events; the route
			// that carries them runs the command instead.
			return [];
	}
};

/**
 * What a person's act would say to the agent.
 *
 * The feed's line and this sentence answer different questions: the feed says
 * what happened, this tells the model what changed under it. The page size is
 * named because it is the act that most reliably breaks an agent's assumption
 * about the layout it is about to click in.
 * @param input - what a person did in the panel.
 * @returns one clause, or undefined for an act the agent does not need told.
 */
export const noteOf = (input: PanelInput): string | undefined => {
	switch (input.type) {
		case "mouse":
			return input.event === "click"
				? `clicked at (${Math.round(input.x)}, ${Math.round(input.y)})`
				: undefined;
		case "key":
			return input.event === "down" ? `pressed ${input.key}` : undefined;
		case "navigate":
			return input.to === "reload"
				? "reloaded the page"
				: input.to === "back"
					? "went back"
					: "went forward";
		case "viewport":
			return `changed the page size to ${input.width}×${input.height}`;
		case "wheel":
			return undefined;
	}
};

/**
 * What a person's input reads as in the feed.
 *
 * Only the acts that changed the page are worth a line. A hover and a scroll
 * reveal themselves in the picture, and going back is a command the CLI reports
 * on its own — a second line for it would say the same thing twice.
 * @param input - what a person did in the panel.
 * @returns the line's text, or undefined when the act is not worth one.
 */
export const humanLineOf = (input: PanelInput): string | undefined => {
	switch (input.type) {
		case "mouse":
			return input.event === "click"
				? `click ${Math.round(input.x)}×${Math.round(input.y)}`
				: undefined;
		case "key":
			return input.event === "down" ? `key ${input.key}` : undefined;
		case "navigate":
		case "viewport":
		case "wheel":
			return undefined;
	}
};

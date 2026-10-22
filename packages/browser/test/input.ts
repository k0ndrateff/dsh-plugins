/**
 * What a person's click becomes, from the body that arrives to the messages the
 * page receives.
 *
 * The input path is where a panel's picture turns back into a page, so every
 * case here is checked twice: what a request is allowed to say, and what the
 * screencast is then told. Both halves are pure, so neither needs a browser.
 *
 *   bun run test/input.ts
 */

import {
	buttonOf,
	modifiersOf,
	viewportPointOf,
} from "../src/client/sidebar/input";
import { readPanelInput } from "../src/host/panel/input";
import { humanLineOf, wireMessagesOf } from "../src/host/stream/input";
import type { PanelInput } from "../src/shared/panel";
import { check, report, section } from "./harness";

const NO_FLAGS = { alt: false, ctrl: false, meta: false, shift: false };

/** One reading's input, or undefined when it was refused. */
const inputOf = (value: unknown): PanelInput | undefined => {
	const reading = readPanelInput(value);

	return reading.ok ? reading.input : undefined;
};

/** The message at one position, when there is one. */
const at = (
	input: PanelInput,
	index: number,
): Readonly<Record<string, unknown>> | undefined =>
	wireMessagesOf(input)[index];

section("a click, before it is trusted");
const click = inputOf({
	type: "mouse",
	event: "click",
	x: 120,
	y: 40,
	button: "left",
});
check("a click is read", click?.type === "mouse" && click.event === "click");
check("with its point", click?.type === "mouse" && click.x === 120);
check(
	"and modifiers nobody held",
	click?.type === "mouse" && click.modifiers.ctrl === false,
);
check(
	"a click with no point is refused",
	inputOf({ type: "mouse", event: "click", button: "left" }) === undefined,
);
check(
	"a point outside the page is refused",
	inputOf({
		type: "mouse",
		event: "click",
		x: -4,
		y: 40,
		button: "left",
	}) === undefined,
);
check(
	"a button the page does not have is refused",
	inputOf({
		type: "mouse",
		event: "click",
		x: 4,
		y: 40,
		button: "back",
	}) === undefined,
);
check(
	"and an event that is not a mouse event is refused",
	inputOf({
		type: "mouse",
		event: "wiggle",
		x: 4,
		y: 40,
		button: "left",
	}) === undefined,
);
check(
	"the reason is a sentence",
	readPanelInput({ type: "mouse" }).ok === false &&
		String(
			(readPanelInput({ type: "mouse" }) as { reason: string }).reason,
		).includes("x and a y"),
);

section("a wheel and a key");
const wheel = inputOf({ type: "wheel", x: 10, y: 20, deltaY: 120 });
check(
	"a wheel carries its own movement",
	wheel?.type === "wheel" && wheel.deltaY === 120,
);
check(
	"and its missing axis is still a number",
	wheel?.type === "wheel" && wheel.deltaX === 0,
);
const key = inputOf({ type: "key", event: "down", key: "Enter" });
check("a key is read", key?.type === "key" && key.key === "Enter");
check(
	"a key with no name is refused",
	inputOf({ type: "key", event: "down", key: "" }) === undefined,
);
check(
	"a key event that goes neither way is refused",
	inputOf({ type: "key", event: "sideways", key: "a" }) === undefined,
);

section("a navigation and nothing else");
check(
	"going back is an input",
	inputOf({ type: "navigate", to: "back" })?.type === "navigate",
);
check(
	"a direction the page cannot take is refused",
	inputOf({ type: "navigate", to: "sideways" }) === undefined,
);
check("an unknown input is refused", inputOf({ type: "jump" }) === undefined);
check("a body that is not an object is refused", inputOf([]) === undefined);

section("a page size");
check(
	"a size a page could have is an input",
	inputOf({ type: "viewport", width: 390, height: 844 })?.type === "viewport",
);
check(
	"a size no page could have is refused",
	inputOf({ type: "viewport", width: 40, height: 844 }) === undefined,
);
check(
	"and so is half of one",
	inputOf({ type: "viewport", width: 390 }) === undefined,
);

section("what the page is told");
check(
	"a click is a press and a release",
	wireMessagesOf(click as PanelInput).length === 2 &&
		at(click as PanelInput, 1)?.eventType === "mouseReleased",
);
check(
	"the press is the click",
	at(click as PanelInput, 0)?.eventType === "mousePressed" &&
		at(click as PanelInput, 0)?.clickCount === 1,
);
check(
	"with the point the panel measured",
	at(click as PanelInput, 0)?.x === 120 && at(click as PanelInput, 0)?.y === 40,
);
check("and no modifiers held", at(click as PanelInput, 0)?.modifiers === 0);

const chord: PanelInput = {
	type: "mouse",
	event: "click",
	x: 1,
	y: 2,
	button: "left",
	modifiers: { alt: false, ctrl: true, meta: false, shift: true },
};
check("held buttons are a bitmask", at(chord, 0)?.modifiers === 10);
check(
	"a right click keeps its button",
	at(
		{
			type: "mouse",
			event: "click",
			x: 1,
			y: 2,
			button: "right",
			modifiers: NO_FLAGS,
		},
		0,
	)?.button === "right",
);
check(
	"a hover is one move",
	wireMessagesOf({
		type: "mouse",
		event: "move",
		x: 3,
		y: 4,
		button: "left",
		modifiers: NO_FLAGS,
	}).length === 1 &&
		at(
			{
				type: "mouse",
				event: "move",
				x: 3,
				y: 4,
				button: "left",
				modifiers: NO_FLAGS,
			},
			0,
		)?.eventType === "mouseMoved",
);
check(
	"a wheel is a mouse event with no button",
	at(wheel as PanelInput, 0)?.eventType === "mouseWheel" &&
		at(wheel as PanelInput, 0)?.button === "none" &&
		at(wheel as PanelInput, 0)?.deltaY === 120,
);

const letter: PanelInput = {
	type: "key",
	event: "down",
	key: "a",
	code: "KeyA",
	modifiers: NO_FLAGS,
};
check("a letter carries its own text", at(letter, 0)?.text === "a");
check(
	"Enter inserts a line break",
	at(
		{
			type: "key",
			event: "down",
			key: "Enter",
			code: "Enter",
			modifiers: NO_FLAGS,
		},
		0,
	)?.text === "\r",
);
check(
	"and is the code the keyboard produces",
	at(
		{
			type: "key",
			event: "down",
			key: "Enter",
			code: "Enter",
			modifiers: NO_FLAGS,
		},
		0,
	)?.windowsVirtualKeyCode === 13,
);
check(
	"a letter is the key above the letter",
	at(letter, 0)?.windowsVirtualKeyCode === 65,
);
check(
	"while a release inserts nothing",
	at(
		{ type: "key", event: "up", key: "a", code: "KeyA", modifiers: NO_FLAGS },
		0,
	)?.text === undefined,
);
check(
	"a navigation is a command, not a message",
	wireMessagesOf({ type: "navigate", to: "back" }).length === 0,
);
check(
	"and so is a page size",
	wireMessagesOf({ type: "viewport", width: 390, height: 844 }).length === 0,
);

section("what the person's act reads as in the feed");
check(
	"a click names where it landed",
	humanLineOf(click as PanelInput) === "click 120×40",
);
check(
	"a key names what was pressed",
	humanLineOf({
		type: "key",
		event: "down",
		key: "Enter",
		code: "Enter",
		modifiers: NO_FLAGS,
	}) === "key Enter",
);
check(
	"a release is not worth a line",
	humanLineOf({
		type: "key",
		event: "up",
		key: "Enter",
		code: "Enter",
		modifiers: NO_FLAGS,
	}) === undefined,
);
check(
	"a hover is not worth a line",
	humanLineOf({
		type: "mouse",
		event: "move",
		x: 3,
		y: 4,
		button: "left",
		modifiers: NO_FLAGS,
	}) === undefined,
);
check(
	"and a wheel is the page's own movement",
	humanLineOf(wheel as PanelInput) === undefined,
);

section("where a click lands in the page");
const pictureBox = { left: 16, top: 100, width: 400, height: 300 };
const page = { width: 1_280, height: 720 };
const middle = viewportPointOf(
	{ clientX: 16 + 200, clientY: 100 + 150 },
	pictureBox,
	page,
);
check(
	"the middle of the picture is the middle of the page",
	middle?.x === 640 && middle?.y === 360,
);
const corner = viewportPointOf({ clientX: 16, clientY: 100 }, pictureBox, page);
check("the corner is the corner", corner?.x === 0 && corner?.y === 0);
const outside = viewportPointOf({ clientX: 0, clientY: 0 }, pictureBox, page);
check(
	"a point outside the picture is its edge, not a drop",
	outside?.x === 0 && outside?.y === 0,
);
check(
	"a picture with no size measures nothing",
	viewportPointOf(
		{ clientX: 1, clientY: 1 },
		{ left: 0, top: 0, width: 0, height: 0 },
		page,
	) === undefined,
);
check(
	"and neither does a page with no size",
	viewportPointOf({ clientX: 1, clientY: 1 }, pictureBox, {
		width: 0,
		height: 0,
	}) === undefined,
);
check(
	"the right and middle buttons keep their names",
	buttonOf(2) === "right" && buttonOf(1) === "middle" && buttonOf(0) === "left",
);
check(
	"and the held buttons are read from the event",
	modifiersOf({
		altKey: false,
		ctrlKey: true,
		metaKey: false,
		shiftKey: true,
	}).ctrl === true &&
		modifiersOf({
			altKey: false,
			ctrlKey: true,
			metaKey: false,
			shiftKey: true,
		}).shift === true,
);

report();

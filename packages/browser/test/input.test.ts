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

import { expect, test } from "bun:test";
import {
	buttonOf,
	modifiersOf,
	pagePointOf,
} from "../src/client/sidebar/input";
import { readPanelInput } from "../src/host/panel/input";
import { humanLineOf, wireMessagesOf } from "../src/host/stream/input";
import type { PanelInput } from "../src/shared/panel";

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

const click = inputOf({
	type: "mouse",
	event: "click",
	x: 120,
	y: 40,
	button: "left",
});
const wheel = inputOf({ type: "wheel", x: 10, y: 20, deltaY: 120 });
const key = inputOf({ type: "key", event: "down", key: "Enter" });

test("a click, before it is trusted", async () => {
	expect(
		click?.type === "mouse" && click.event === "click",
		"a click is read",
	).toBe(true);
	expect(click?.type === "mouse" && click.x === 120, "with its point").toBe(
		true,
	);
	expect(
		click?.type === "mouse" && click.modifiers.ctrl === false,
		"and modifiers nobody held",
	).toBe(true);
	expect(
		inputOf({ type: "mouse", event: "click", button: "left" }) === undefined,
		"a click with no point is refused",
	).toBe(true);
	expect(
		inputOf({
			type: "mouse",
			event: "click",
			x: -4,
			y: 40,
			button: "left",
		}) === undefined,
		"a point outside the page is refused",
	).toBe(true);
	expect(
		inputOf({
			type: "mouse",
			event: "click",
			x: 4,
			y: 40,
			button: "back",
		}) === undefined,
		"a button the page does not have is refused",
	).toBe(true);
	expect(
		inputOf({
			type: "mouse",
			event: "wiggle",
			x: 4,
			y: 40,
			button: "left",
		}) === undefined,
		"and an event that is not a mouse event is refused",
	).toBe(true);
	expect(
		readPanelInput({ type: "mouse" }).ok === false &&
			String(
				(readPanelInput({ type: "mouse" }) as { reason: string }).reason,
			).includes("x and a y"),
		"the reason is a sentence",
	).toBe(true);
});
test("a wheel and a key", async () => {
	expect(
		wheel?.type === "wheel" && wheel.deltaY === 120,
		"a wheel carries its own movement",
	).toBe(true);
	expect(
		wheel?.type === "wheel" && wheel.deltaX === 0,
		"and its missing axis is still a number",
	).toBe(true);
	expect(key?.type === "key" && key.key === "Enter", "a key is read").toBe(
		true,
	);
	expect(
		inputOf({ type: "key", event: "down", key: "" }) === undefined,
		"a key with no name is refused",
	).toBe(true);
	expect(
		inputOf({ type: "key", event: "sideways", key: "a" }) === undefined,
		"a key event that goes neither way is refused",
	).toBe(true);
});
test("a navigation and nothing else", async () => {
	expect(
		inputOf({ type: "navigate", to: "back" })?.type === "navigate",
		"going back is an input",
	).toBe(true);
	expect(
		inputOf({ type: "navigate", to: "sideways" }) === undefined,
		"a direction the page cannot take is refused",
	).toBe(true);
	expect(
		inputOf({ type: "jump" }) === undefined,
		"an unknown input is refused",
	).toBe(true);
	expect(
		inputOf([]) === undefined,
		"a body that is not an object is refused",
	).toBe(true);
});
test("a page size", async () => {
	expect(
		inputOf({ type: "viewport", width: 390, height: 844 })?.type === "viewport",
		"a size a page could have is an input",
	).toBe(true);
	expect(
		inputOf({ type: "viewport", width: 40, height: 844 }) === undefined,
		"a size no page could have is refused",
	).toBe(true);
	expect(
		inputOf({ type: "viewport", width: 390 }) === undefined,
		"and so is half of one",
	).toBe(true);
});
test("what the page is told", async () => {
	expect(
		wireMessagesOf(click as PanelInput).length === 2 &&
			at(click as PanelInput, 1)?.eventType === "mouseReleased",
		"a click is a press and a release",
	).toBe(true);
	expect(
		at(click as PanelInput, 0)?.eventType === "mousePressed" &&
			at(click as PanelInput, 0)?.clickCount === 1,
		"the press is the click",
	).toBe(true);
	expect(
		at(click as PanelInput, 0)?.x === 120 &&
			at(click as PanelInput, 0)?.y === 40,
		"with the point the panel measured",
	).toBe(true);
	expect(
		at(click as PanelInput, 0)?.modifiers === 0,
		"and no modifiers held",
	).toBe(true);

	const chord: PanelInput = {
		type: "mouse",
		event: "click",
		x: 1,
		y: 2,
		button: "left",
		modifiers: { alt: false, ctrl: true, meta: false, shift: true },
	};
	expect(at(chord, 0)?.modifiers === 10, "held buttons are a bitmask").toBe(
		true,
	);
	expect(
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
		"a right click keeps its button",
	).toBe(true);
	expect(
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
		"a hover is one move",
	).toBe(true);
	expect(
		at(wheel as PanelInput, 0)?.eventType === "mouseWheel" &&
			at(wheel as PanelInput, 0)?.button === "none" &&
			at(wheel as PanelInput, 0)?.deltaY === 120,
		"a wheel is a mouse event with no button",
	).toBe(true);

	const letter: PanelInput = {
		type: "key",
		event: "down",
		key: "a",
		code: "KeyA",
		modifiers: NO_FLAGS,
	};
	expect(at(letter, 0)?.text === "a", "a letter carries its own text").toBe(
		true,
	);
	expect(
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
		"Enter inserts a line break",
	).toBe(true);
	expect(
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
		"and is the code the keyboard produces",
	).toBe(true);
	expect(
		at(letter, 0)?.windowsVirtualKeyCode === 65,
		"a letter is the key above the letter",
	).toBe(true);
	expect(
		at(
			{ type: "key", event: "up", key: "a", code: "KeyA", modifiers: NO_FLAGS },
			0,
		)?.text === undefined,
		"while a release inserts nothing",
	).toBe(true);
	expect(
		wireMessagesOf({ type: "navigate", to: "back" }).length === 0,
		"a navigation is a command, not a message",
	).toBe(true);
	expect(
		wireMessagesOf({ type: "viewport", width: 390, height: 844 }).length === 0,
		"and so is a page size",
	).toBe(true);
});
test("what the person's act reads as in the feed", async () => {
	expect(
		humanLineOf(click as PanelInput) === "click 120×40",
		"a click names where it landed",
	).toBe(true);
	expect(
		humanLineOf({
			type: "key",
			event: "down",
			key: "Enter",
			code: "Enter",
			modifiers: NO_FLAGS,
		}) === "key Enter",
		"a key names what was pressed",
	).toBe(true);
	expect(
		humanLineOf({
			type: "key",
			event: "up",
			key: "Enter",
			code: "Enter",
			modifiers: NO_FLAGS,
		}) === undefined,
		"a release is not worth a line",
	).toBe(true);
	expect(
		humanLineOf({
			type: "mouse",
			event: "move",
			x: 3,
			y: 4,
			button: "left",
			modifiers: NO_FLAGS,
		}) === undefined,
		"a hover is not worth a line",
	).toBe(true);
	expect(
		humanLineOf(wheel as PanelInput) === undefined,
		"and a wheel is the page's own movement",
	).toBe(true);
});
test("where a click lands in the page", async () => {
	const pictureBox = { left: 16, top: 100, width: 400, height: 198 };
	const desktopPicture = { naturalWidth: 1_280, naturalHeight: 633 };
	const desktopPage = { width: 1_280, height: 633 };
	const middle = pagePointOf(
		{ clientX: 16 + 200, clientY: 100 + 99 },
		pictureBox,
		desktopPicture,
		desktopPage,
	);
	expect(
		middle !== undefined &&
			Math.abs(middle.x - 640) <= 2 &&
			Math.abs(middle.y - 316) <= 2,
		"the middle of the picture is the middle of the page",
	).toBe(true);
	expect(
		pagePointOf(
			{ clientX: 16, clientY: 100 },
			pictureBox,
			desktopPicture,
			desktopPage,
		)?.x === 0,
		"the corner is the corner",
	).toBe(true);
	expect(
		pagePointOf(
			{ clientX: 1, clientY: 1 },
			pictureBox,
			{ naturalWidth: 0, naturalHeight: 0 },
			desktopPage,
		) === undefined,
		"a picture that decoded to nothing measures nothing",
	).toBe(true);
	expect(
		pagePointOf({ clientX: 1, clientY: 1 }, pictureBox, desktopPicture, {
			width: 0,
			height: 0,
		}) === undefined,
		"and neither does a page with no size",
	).toBe(true);

	// A phone viewport inside a desktop window: the page is 390x844, the picture is
	// 474x800 because the page was fitted into the window's surface and the leftover
	// sits beside it.
	const phonePicture = { naturalWidth: 474, naturalHeight: 800 };
	const phonePage = { width: 390, height: 844 };
	const phoneBox = { left: 0, top: 0, width: 474, height: 800 };
	const aimedAtButton = pagePointOf(
		{ clientX: 184, clientY: 536 },
		phoneBox,
		phonePicture,
		phonePage,
	);
	expect(
		aimedAtButton !== undefined &&
			Math.abs(aimedAtButton.x - 194) <= 1 &&
			Math.abs(aimedAtButton.y - 565) <= 2,
		"a fitted page is measured by the factor the fit used",
	).toBe(true);
	expect(
		pagePointOf(
			{ clientX: 430, clientY: 300 },
			phoneBox,
			phonePicture,
			phonePage,
		) === undefined,
		"the strip beside the page is not the page",
	).toBe(true);
	expect(
		pagePointOf(
			{ clientX: 10, clientY: -4 },
			{ ...phoneBox, top: 0 },
			phonePicture,
			phonePage,
		) === undefined,
		"and a point above the picture is not either",
	).toBe(true);
	expect(
		buttonOf(2) === "right" &&
			buttonOf(1) === "middle" &&
			buttonOf(0) === "left",
		"the right and middle buttons keep their names",
	).toBe(true);
	expect(
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
		"and the held buttons are read from the event",
	).toBe(true);
});

/**
 * What the two halves agree a settled browser call leaves for its row.
 *
 * The host half projects each tool's own return value into one of these shapes
 * and hands it to the tool pipeline as `presentationMeta`; the harness persists
 * it on the tool result and the Web Client reads it back as `meta`. The halves
 * are separate bundles with no shared runtime, so this file is the whole
 * contract: the types, one defensive reader per shape, and a dispatcher that
 * tells the shapes apart.
 *
 * The tag in {@link BrowserMeta} is not on the wire. Every shape carries a field
 * no other shape has, so no tool's metadata can be read as another's, and the
 * row can switch on the tag without being told which tool's call it is drawing.
 */

import {
	boolean,
	nonEmptyString,
	number,
	object,
	optional,
	required,
	string,
} from "dsh-integration-host/shape";
import type { PanelOpenMeta } from "./panel";

/** What a settled `browser_snapshot` leaves for its row. */
export type SnapshotMeta = {
	/** How many `@eN` references the tree handed out. */
	readonly elements: number;
	/** The page the tree was read from; empty when the CLI named no origin. */
	readonly url: string;
	/** Whether the tree held only the elements a person can act on. */
	readonly interactive: boolean;
	/** The part of the page that was read; empty for the whole page. */
	readonly selector: string;
};

/** What a settled `browser_act` leaves for its row. */
export type ActMeta = {
	/** The verb the call ran: `click`, `fill`, `press`, and so on. */
	readonly action: string;
	/** The element, key, direction or wait the verb acted on. */
	readonly target: string;
	/** The address the page ended on; empty when there was none to report. */
	readonly url: string;
	/**
	 * Whether the address could not be read at all.
	 *
	 * This is not "the page did not move": the two answer opposite questions
	 * about the same empty string.
	 */
	readonly addressUnread: boolean;
};

/** What a settled `browser_read` leaves for its row. */
export type ReadMeta = {
	/** Which log was read: `text`, `console` or `errors`. */
	readonly what: string;
	/** How many lines the model can actually read, after the answer cap. */
	readonly count: number;
};

/** What a settled `browser_run` leaves for its row. */
export type RunMeta = {
	/** The command and its arguments, joined the way a person types them. */
	readonly command: string;
	/** Whether the command answered nothing at all. */
	readonly empty: boolean;
};

/** What a settled `browser_screenshot` leaves for its row. */
export type ScreenshotMeta = {
	/** The page that was photographed; empty when the address could not be read. */
	readonly url: string;
	/** `png` or `jpeg`. */
	readonly format: string;
	/** The size of the file the CLI wrote. */
	readonly bytes: number;
	/** The picture's own width, when the image store kept it. */
	readonly width?: number;
	/** The picture's own height, when the image store kept it. */
	readonly height?: number;
};

/** What a settled `browser_close` leaves for its row. */
export type CloseMeta = {
	/** Whether there was a browser to close; false means there was none. */
	readonly closed: boolean;
};

/**
 * One settled call's metadata, tagged with the shape its tool recorded.
 *
 * `browser_open` records the panel's own open metadata, because the same fact
 * both opens the panel and labels the row.
 */
export type BrowserMeta =
	| ({ readonly kind: "open" } & PanelOpenMeta)
	| ({ readonly kind: "snapshot" } & SnapshotMeta)
	| ({ readonly kind: "act" } & ActMeta)
	| ({ readonly kind: "read" } & ReadMeta)
	| ({ readonly kind: "run" } & RunMeta)
	| ({ readonly kind: "screenshot" } & ScreenshotMeta)
	| ({ readonly kind: "close" } & CloseMeta);

/** Narrow one `browser_open` result's metadata. */
export const asOpenMeta = object<PanelOpenMeta>({
	session: required(nonEmptyString),
	url: required(string),
	title: required(string),
});

/** Narrow one `browser_snapshot` result's metadata. */
export const asSnapshotMeta = object<SnapshotMeta>({
	elements: required(number),
	url: required(string),
	interactive: required(boolean),
	selector: required(string),
});

/** Narrow one `browser_act` result's metadata. */
export const asActMeta = object<ActMeta>({
	action: required(nonEmptyString),
	target: required(nonEmptyString),
	url: required(string),
	addressUnread: required(boolean),
});

/** Narrow one `browser_read` result's metadata. */
export const asReadMeta = object<ReadMeta>({
	what: required(nonEmptyString),
	count: required(number),
});

/** Narrow one `browser_run` result's metadata. */
export const asRunMeta = object<RunMeta>({
	command: required(nonEmptyString),
	empty: required(boolean),
});

/** Narrow one `browser_screenshot` result's metadata. */
export const asScreenshotMeta = object<ScreenshotMeta>({
	url: required(string),
	format: required(nonEmptyString),
	bytes: required(number),
	width: optional(number),
	height: optional(number),
});

/** Narrow one `browser_close` result's metadata. */
export const asCloseMeta = object<CloseMeta>({
	closed: required(boolean),
});

/**
 * Narrow a settled call's metadata, whichever browser tool recorded it.
 * @param value - the opaque `meta` of a tool result.
 * @returns the metadata tagged with its shape, or undefined when this half does
 *   not know it — a call recorded by another version of the plugin.
 */
export const asBrowserMeta = (value: unknown): BrowserMeta | undefined => {
	const open = asOpenMeta(value);
	if (open !== undefined) return { kind: "open", ...open };

	const snapshot = asSnapshotMeta(value);
	if (snapshot !== undefined) return { kind: "snapshot", ...snapshot };

	const act = asActMeta(value);
	if (act !== undefined) return { kind: "act", ...act };

	const read = asReadMeta(value);
	if (read !== undefined) return { kind: "read", ...read };

	const run = asRunMeta(value);
	if (run !== undefined) return { kind: "run", ...run };

	const screenshot = asScreenshotMeta(value);
	if (screenshot !== undefined) return { kind: "screenshot", ...screenshot };

	const close = asCloseMeta(value);
	if (close !== undefined) return { kind: "close", ...close };

	return undefined;
};

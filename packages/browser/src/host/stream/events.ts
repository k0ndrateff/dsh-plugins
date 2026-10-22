/**
 * What agent-browser's stream says, in this plugin's own words.
 *
 * The stream speaks more kinds than a panel needs — `status`, `tabs`, `frame`,
 * `command`, `result`, `url` — in the CLI's own shapes, and this is the one place
 * that knows them. Above here there is only a frame, an address and an activity
 * line.
 *
 * Two kinds are dropped on purpose. `launch` pairs, because the CLI reports one
 * before *every* call — every call is a fresh process attaching — and a feed of
 * them would bury the actions a reader is watching for. `status`, because the one
 * thing a reader needs from it, whether the connection is up, is what this side
 * of the socket already knows.
 *
 * One command is dropped for the same reason: the page-size probe this plugin
 * runs for its own arithmetic. It is not something the agent did to the page, and
 * a reader watching the agent work should not see the panel's bookkeeping in the
 * middle of it.
 */

/** One encoded viewport frame, as the CLI sends it. */
export interface StreamFrame {
	readonly seq: number;
	/** The viewport's size, which is not the image's: clicks are measured here. */
	readonly width: number;
	readonly height: number;
	/** One JPEG, base64. */
	readonly data: string;
}

/** One line of the feed. */
export interface StreamActivity {
	readonly kind: "command" | "result";
	/** The CLI's own id, which pairs a command with its outcome. */
	readonly id: string;
	readonly text: string;
	readonly at: number;
}

/** Everything one stream message means to this plugin. */
export type StreamEvent =
	| {
			readonly kind: "address";
			readonly url: string;
			readonly title: string | undefined;
	  }
	| { readonly kind: "frame"; readonly frame: StreamFrame }
	| { readonly kind: "activity"; readonly activity: StreamActivity };

import { PAGE_SIZE_SCRIPT } from "./page";

/** Actions the CLI reports about itself rather than about the page. */
const DROPPED_ACTIONS: readonly string[] = ["launch"];

/** The parameter worth showing beside an action's name, in order of usefulness. */
const DETAIL_KEYS: readonly string[] = [
	"selector",
	"url",
	"key",
	"text",
	"value",
	"direction",
	"what",
];

/** One payload field, when it is a plain object. */
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** One payload field, when it is a finite number. */
const numberOf = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** One payload field, when it is a non-empty string. */
const textOf = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/** One payload field, when it is a list. */
const listOf = (value: unknown): readonly unknown[] | undefined =>
	Array.isArray(value) ? value : undefined;

/** Whether one command was this plugin asking the page for its own size. */
const isProbe = (params: unknown): boolean =>
	recordOf(params)?.script === PAGE_SIZE_SCRIPT;

/**
 * What one command reads as in the feed.
 * @param action - the CLI's own action name, such as `click`.
 * @param params - what the command was run with.
 */
export const commandText = (action: string, params: unknown): string => {
	const record = recordOf(params);

	if (record === undefined) return action;

	for (const key of DETAIL_KEYS) {
		const value = textOf(record[key]);

		if (value !== undefined) return `${action} ${value}`;
	}

	return action;
};

/**
 * What one outcome reads as: how long the command took.
 * @param durationMs - the CLI's own measurement, when it sent one.
 */
export const resultText = (durationMs: number | undefined): string =>
	durationMs === undefined ? "done" : `${durationMs}ms`;

/**
 * Read one stream message.
 * @param text - the frame's payload, as text.
 * @returns what it means here, or undefined for a kind this plugin ignores.
 */
export const parseStreamMessage = (text: string): StreamEvent | undefined => {
	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}

	const message = recordOf(parsed);

	if (message === undefined) return undefined;

	const type = textOf(message.type);

	if (type === "frame") {
		const data = textOf(message.data);

		if (data === undefined) return undefined;

		const metadata = recordOf(message.metadata);

		return {
			kind: "frame",
			frame: {
				seq: numberOf(message.seq) ?? 0,
				width: numberOf(metadata?.deviceWidth) ?? 0,
				height: numberOf(metadata?.deviceHeight) ?? 0,
				data,
			},
		};
	}

	if (type === "tabs") {
		const tabs = listOf(message.tabs) ?? [];
		const tab =
			recordOf(tabs.find((one) => recordOf(one)?.active === true)) ??
			recordOf(tabs[0]);
		const url = textOf(tab?.url);

		return url === undefined
			? undefined
			: { kind: "address", url, title: textOf(tab?.title) };
	}

	if (type === "url") {
		const url = textOf(message.url);

		return url === undefined
			? undefined
			: { kind: "address", url, title: undefined };
	}

	if (type === "command" || type === "result") {
		const action = textOf(message.action);
		const id = textOf(message.id);

		if (action === undefined || id === undefined) return undefined;
		if (DROPPED_ACTIONS.includes(action)) return undefined;
		if (action === "evaluate" && isProbe(message.params)) return undefined;

		const at = numberOf(message.timestamp) ?? Date.now();

		return {
			kind: "activity",
			activity:
				type === "command"
					? {
							kind: "command",
							id,
							text: commandText(action, message.params),
							at,
						}
					: {
							kind: "result",
							id,
							text: resultText(numberOf(message.duration_ms)),
							at,
						},
		};
	}

	return undefined;
};

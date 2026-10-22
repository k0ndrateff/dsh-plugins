/**
 * The activity feed, as a person reads it.
 *
 * The stream reports pairs — a command, then its outcome — in the CLI's own
 * words, and a list of `snapshot` / `8ms` / `click @e2` is a log, not an account
 * of what happened. This is the one place that folds a pair into a line: a verb
 * a reader understands, what it acted on, and how long it took.
 *
 * Unknown commands keep their own name rather than being guessed at: a feed that
 * invents an interpretation of a command nobody taught it is worse than one that
 * shows the command.
 */

import type { PanelActivity } from "../../shared/panel";

/** One action, as the panel shows it. */
export interface FeedLine {
	/** What happened, in a reader's words. */
	readonly label: string;
	/** What it acted on, when the command named something. */
	readonly detail: string;
	/** How long it took, once the outcome arrived. */
	readonly durationMs: number | undefined;
	/** When the command was reported. */
	readonly at: number;
}

/** What each command this plugin's tools run reads as. */
const LABELS: Readonly<Record<string, string>> = {
	click: "Clicked",
	fill: "Typed into",
	press: "Pressed",
	select: "Selected",
	hover: "Hovered over",
	scroll: "Scrolled",
	wait: "Waited for",
	snapshot: "Took a snapshot",
	console: "Read the console",
	errors: "Read the page errors",
	read: "Read the page",
	url: "Read the address",
	geturl: "Read the address",
	gettext: "Read the text",
	reload: "Reloaded the page",
	back: "Went back",
	forward: "Went forward",
	open: "Opened",
	close: "Closed the browser",
	tab: "Changed tabs",
	network: "Checked the network",
};

/**
 * What the person at the panel did reads as.
 *
 * Their own acts carry their own voice in the same list, so one feed answers
 * "what happened to this page" without asking who did it.
 */
const HUMAN_LABELS: Readonly<Record<string, string>> = {
	click: "You clicked",
	key: "You pressed",
};

/** One item's action name, and what it acted on. */
const split = (text: string): { action: string; detail: string } => {
	const space = text.indexOf(" ");

	return space === -1
		? { action: text, detail: "" }
		: { action: text.slice(0, space), detail: text.slice(space + 1) };
};

/** How long one outcome line reports, when it reports a number at all. */
const durationOf = (text: string): number | undefined => {
	const match = /^(\d+(?:\.\d+)?)ms$/u.exec(text.trim());

	return match?.[1] === undefined ? undefined : Number(match[1]);
};

/**
 * Read the feed as lines: commands lead, their outcomes fold into them.
 * @param items - the window the host reported, newest last.
 * @returns one line per action, in the order they were taken.
 */
export const feedLines = (
	items: readonly PanelActivity[],
): readonly FeedLine[] => {
	const lines: FeedLine[] = [];
	let waiting = false;

	for (const item of items) {
		if (item.kind === "result") {
			const previous = lines.at(-1);

			// An outcome with no command of its own belongs to a call that started
			// before this window did; it is not a line a reader can place.
			if (previous === undefined || !waiting) continue;

			lines[lines.length - 1] = {
				...previous,
				durationMs: durationOf(item.text),
			};
			waiting = false;

			continue;
		}

		const { action, detail } = split(item.text);

		// A person's own act has no outcome to wait for, and never adopts one: the
		// agent's next outcome belongs to the agent's next command.
		waiting = item.kind === "command";

		lines.push({
			label:
				item.kind === "human"
					? (HUMAN_LABELS[action] ?? `You ${action}`)
					: (LABELS[action] ?? action),
			detail,
			durationMs: undefined,
			at: item.at,
		});
	}

	return lines;
};

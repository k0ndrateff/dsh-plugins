/**
 * What one browser tool row says, in the reader's words.
 *
 * The row shell belongs to `dsh-integration-ui`; what is the browser's is the
 * line itself: the label for the tool, what a preparing call asked for, and what
 * a settled call found. Those are pure functions of the arguments and of the
 * metadata the host recorded, so they live here, apart from the JSX module, and
 * are testable without a renderer.
 *
 * The settled line comes from {@link BrowserMeta} rather than from the tool's own
 * answer: the answer is large JSON, and a row that reproduces it buries what the
 * call actually did.
 */

import type { ToolRowBlock } from "dsh-integration-ui";
import { asBrowserMeta, type BrowserMeta } from "../../shared/meta";
import {
	BROWSER_ACT_TOOL,
	BROWSER_CLOSE_TOOL,
	BROWSER_OPEN_TOOL,
	BROWSER_READ_TOOL,
	BROWSER_RUN_TOOL,
	BROWSER_SCREENSHOT_TOOL,
	BROWSER_SNAPSHOT_TOOL,
} from "../../shared/tools";

/** The label each browser tool's row leads with. */
const TOOL_LABELS: Readonly<Record<string, string>> = {
	[BROWSER_OPEN_TOOL]: "Browser page",
	[BROWSER_SNAPSHOT_TOOL]: "Browser snapshot",
	[BROWSER_ACT_TOOL]: "Browser action",
	[BROWSER_READ_TOOL]: "Browser read",
	[BROWSER_RUN_TOOL]: "Browser command",
	[BROWSER_SCREENSHOT_TOOL]: "Browser screenshot",
	[BROWSER_CLOSE_TOOL]: "Browser close",
};

/** How each verb `browser_act` accepts reads after it happened. */
const VERBS: Readonly<Record<string, string>> = {
	click: "clicked",
	fill: "filled",
	press: "pressed",
	select: "selected",
	hover: "hovered",
	scroll: "scrolled",
	wait: "waited",
};

/** How long the server's own sentence may get when it stands in for a row. */
const FALLBACK_CHARS = 80;

/**
 * One tool's label, in the reader's words.
 * @param toolName - the name the slot dispatched the call under.
 */
export const toolLabel = (toolName: string | undefined): string =>
	TOOL_LABELS[toolName ?? ""] ?? "Browser";

/** A count with the noun it counts, singular or plural. */
const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

/** A count of bytes as a person reads it. */
const bytesText = (bytes: number): string =>
	bytes < 1_024 ? `${bytes} bytes` : `${Math.round(bytes / 1_024)} KB`;

/** The parts of one line that have something to say, joined by dots. */
const joined = (parts: readonly (string | undefined)[]): string =>
	parts
		.filter((part): part is string => part !== undefined && part !== "")
		.join(" · ");

/**
 * What a preparing call asked for, from its arguments.
 *
 * One function for seven tools: the arguments follow each tool's own schema, so a
 * field recognized here names the tool that sent it. A call carrying nothing
 * recognizable — a close, or a snapshot asking for everything — has no specific
 * answer to give, and the row says that it is still working.
 * @param args - the call's arguments, as `blockArgs` parsed them.
 */
export const askedFor = (
	args: Readonly<Record<string, unknown>>,
): string | undefined => {
	const text = (value: unknown): string | undefined =>
		typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

	const url = text(args.url);
	if (url !== undefined) return url;

	const action = text(args.action);
	const target = text(args.target);
	if (action !== undefined && target !== undefined)
		return `${action} ${target}`;

	const what = text(args.what);
	if (what !== undefined) return what;

	const command = Array.isArray(args.args)
		? args.args.filter((entry): entry is string => typeof entry === "string")
		: [];
	if (command.length > 0) return command.join(" ");

	const details = [
		text(args.selector),
		args.interactive === false
			? "whole tree"
			: args.interactive === true
				? "interactive elements"
				: undefined,
		args.full === true ? "full page" : undefined,
		text(args.format),
	].filter((part): part is string => part !== undefined);

	return details.length === 0 ? undefined : details.join(" · ");
};

/**
 * The first line of the server's own answer.
 *
 * A call recorded by one version of the plugin and read by another may carry
 * metadata this half cannot narrow; the answer is still there, and its first
 * line is a better row than nothing. It is cut to one reasonable line because a
 * tree or a JSON answer would otherwise be the row.
 */
const answerOf = (block: ToolRowBlock | undefined): string => {
	const answer = (block?.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("\n")
		.trim();
	const line = answer
		.split("\n")
		.map((one) => one.trim())
		.find((one) => one !== "");

	if (line === undefined) return "done";

	return line.length <= FALLBACK_CHARS
		? line
		: `${line.slice(0, FALLBACK_CHARS - 1)}…`;
};

/** One tagged metadata shape, as the line under the row's label. */
const described = (meta: BrowserMeta): string => {
	switch (meta.kind) {
		case "open":
			if (meta.title !== "") return meta.title;

			return meta.url === "" ? "opened" : meta.url;
		case "snapshot":
			return joined([plural(meta.elements, "element"), meta.url]);
		case "act":
			return joined([
				`${VERBS[meta.action] ?? meta.action} ${meta.target}`,
				meta.addressUnread ? "address unread" : meta.url,
			]);
		case "read":
			return joined([meta.what, plural(meta.count, "line")]);
		case "run":
			return joined([meta.command, meta.empty ? "no answer" : undefined]);
		case "screenshot":
			return joined([
				meta.width === undefined || meta.height === undefined
					? meta.format
					: `${meta.width}×${meta.height} ${meta.format}`,
				bytesText(meta.bytes),
			]);
		case "close":
			return meta.closed ? "closed" : "no browser was open";
	}
};

/**
 * One short phrase describing what a settled call found.
 * @param block - the block the tool-view seat handed the row.
 */
export const summarize = (block: ToolRowBlock | undefined): string => {
	const meta = asBrowserMeta(block?.meta);

	return meta === undefined ? answerOf(block) : described(meta);
};

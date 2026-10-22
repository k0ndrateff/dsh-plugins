/**
 * The browser tool row: one line about the page a call opened.
 *
 * Claiming `browser_open` in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is the browser's is
 * what the line says: the address the call asked for, and the page it landed on.
 *
 * This is also where the panel opens by itself, because a reader watching the
 * agent work wants the viewport in front of them without hunting for it. It opens
 * on **every** settled call, not once: opening a tab that is already there only
 * reveals it, and a panel the user closed must be reachable again by the one
 * action that obviously means "look at this page".
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this module needs: the slot registry
// itself and the tool-view slot contract.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
	type ToolRowProps,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { BROWSER_OPEN_TOOL } from "../../shared/tools";
import { openPanel } from "../sidebar/open";

/** What the host records on a settled `browser_open`, as this half reads it. */
interface OpenMeta {
	/** The agent-browser session that owns the page. */
	readonly session: string;
	/** The address the browser ended on, after any redirect. */
	readonly url: string;
	/** The page's own title; empty when it has none. */
	readonly title: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** The settled call's page, when the host recorded one this half can read. */
const asOpenMeta = (value: unknown): OpenMeta | undefined => {
	if (!isRecord(value)) return undefined;

	const session = value.session;
	const url = value.url;
	const title = value.title;

	if (typeof session !== "string" || session === "") return undefined;
	if (typeof url !== "string" || typeof title !== "string") return undefined;

	return { session, url, title };
};

/** The address a preparing call asked for. */
const askedFor = (block: ToolRowBlock | undefined): string | undefined => {
	const url = blockArgs(block).url;

	return typeof url === "string" && url !== "" ? url : undefined;
};

/** The page a settled call landed on. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const meta = asOpenMeta(block?.meta);
	if (meta === undefined) return "opened";

	return meta.title === "" ? meta.url : meta.title;
};

const Row = createToolRow({
	displayName: () => "Browser",
	asked: askedFor,
	summarize,
});

/** One `browser_open` call, as a single line that shows the page it opened. */
export const BrowserOpenRow = (props: ToolRowProps): ReactNode => {
	const meta =
		props.phase === "result" ? asOpenMeta(props.block?.meta) : undefined;
	const session = meta?.session;
	const url = meta?.url;
	// A row restored from the session log mounts already settled. Opening the
	// panel there would start an old conversation's browser view on page load.
	const mountedAsResult = useRef(props.phase === "result");

	useEffect(() => {
		if (session === undefined || mountedAsResult.current) return;

		openPanel({ session, url });
	}, [session, url]);

	return Row(props);
};

/**
 * Claim `browser_open` for this plugin's row.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const registerBrowserOpenRow = (ctx: Context): void => {
	ctx.slots.inject("tool.call.toolview", () =>
		ctx.slots.register(
			{ name: "tool.call.toolview", key: BROWSER_OPEN_TOOL },
			BrowserOpenRow,
		),
	);
};

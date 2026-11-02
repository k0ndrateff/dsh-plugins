/**
 * The browser tool rows: one line about what each call did to the page.
 *
 * Claiming a tool name in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is the browser's is
 * what the line says: the label of the tool, what the call asked for, and the
 * page or picture it came back with. The words themselves live in
 * `./tool-text`, where they can be read without a renderer.
 *
 * The auto-open is `browser_open`'s alone: that call proves the browser exists,
 * and a reader watching the agent work wants the viewport in front of them
 * without hunting for it. It opens on **every** settled call, not once: opening
 * a tab that is already there only reveals it, and a panel the user closed must
 * be reachable again by the one action that obviously means "look at this page".
 * The other six rows only describe themselves, because a snapshot or a read must
 * not pull the panel over whatever the person is reading.
 */

import type { Context } from "@deepseek-ai/cordis";
// Each import below carries a declaration this module needs: the slot registry
// itself and the tool-view slot contract.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-tool/client";
import {
	blockArgs,
	createToolRow,
	type ToolRowProps,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { asOpenMeta } from "../../shared/meta";
import {
	BROWSER_ACT_TOOL,
	BROWSER_CLOSE_TOOL,
	BROWSER_OPEN_TOOL,
	BROWSER_READ_TOOL,
	BROWSER_RUN_TOOL,
	BROWSER_SCREENSHOT_TOOL,
	BROWSER_SNAPSHOT_TOOL,
} from "../../shared/tools";
import { openPanel } from "../sidebar/open";
import { askedFor, summarize, toolLabel } from "./tool-text";

/** The tools this plugin draws a row for, in the order a session meets them. */
const TOOL_NAMES = [
	BROWSER_OPEN_TOOL,
	BROWSER_SNAPSHOT_TOOL,
	BROWSER_ACT_TOOL,
	BROWSER_READ_TOOL,
	BROWSER_RUN_TOOL,
	BROWSER_SCREENSHOT_TOOL,
	BROWSER_CLOSE_TOOL,
] as const;

const Row = createToolRow({
	displayName: toolLabel,
	asked: (block) => askedFor(blockArgs(block)),
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
 * Claim every browser tool for this plugin's rows.
 * @param ctx - the browser Cordis context carrying the slot registry.
 */
export const registerBrowserOpenRow = (ctx: Context): void => {
	ctx.slots.inject("tool.call.toolview", () => {
		const disposers = TOOL_NAMES.map((name) =>
			ctx.slots.register(
				{ name: "tool.call.toolview", key: name },
				name === BROWSER_OPEN_TOOL ? BrowserOpenRow : Row,
			),
		);

		return () => {
			for (const dispose of disposers) dispose();
		};
	});
};

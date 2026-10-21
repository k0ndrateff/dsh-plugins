/**
 * The Figma tool row: one line about the node a call showed.
 *
 * Claiming `figma_present` in `tool.call.toolview` replaces the generic row for
 * **every** shape of that call — preparing, running, failed, replayed — and the
 * row's own material belongs to `dsh-integration-ui`. What is Figma's is what the
 * line says: the node the call resolved, and what it found there.
 *
 * This is also where the panel opens by itself. A call the page watched run —
 * rather than one replayed from the session log — navigates the right Sidebar to
 * the node it settled on, so the picture is already there while the agent is
 * still working. A replayed call opens nothing: a page reload must not move the
 * user's panels.
 */

import {
	blockArgs,
	createToolRow,
	type ToolRowBlock,
	type ToolRowProps,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { asFigmaPresentation } from "../../shared/meta";
import { openPanel } from "../sidebar/open";

/** The node a preparing call asked for, as the arguments spell it. */
const askedFor = (block: ToolRowBlock | undefined): string | undefined => {
	const node = blockArgs(block).node;

	return typeof node === "string" && node !== ""
		? node
		: "the current selection";
};

/** One short phrase describing what a settled call found. */
const summarize = (block: ToolRowBlock | undefined): string => {
	const card = asFigmaPresentation(block?.meta);
	if (card === undefined) return "done";

	const node = card.node;
	const parts = [
		`${node.type} ${node.width}×${node.height}`,
		node.tokenCount === 0 ? undefined : `${node.tokenCount} variables`,
		node.component,
	].filter((part): part is string => part !== undefined);

	return parts.join(" · ");
};

const Row = createToolRow({
	displayName: () => "Figma frame",
	asked: askedFor,
	summarize,
});

/**
 * Show the settled node in the panel, once, for a call this page watched run.
 *
 * The first render of a call still in flight is what marks it as live: a call
 * replayed from the log renders settled on its first render, and moves nothing.
 */
const useOpenOnSettle = ({ phase, block }: ToolRowProps): void => {
	const watched = useRef(false);

	useEffect(() => {
		if (phase !== "result") {
			watched.current = true;
			return;
		}

		if (!watched.current) return;
		watched.current = false;

		const card = asFigmaPresentation(block?.meta);
		if (card !== undefined) openPanel({ node: card.node.id });
	}, [phase, block]);
};

/** One `figma_present` call, as a single line that opens the node it showed. */
export const FigmaPresentRow = (props: ToolRowProps): ReactNode => {
	useOpenOnSettle(props);

	return Row(props);
};

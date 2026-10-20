/**
 * What one integration's side panel is, as the shared body reads it.
 *
 * Every integration owns its own tab kind and its own body seat, and hands the
 * shared body one of these. The provider keeps what is its own — what a target
 * is, how to fetch it, how to draw it — and the body keeps what is the same
 * everywhere: reading the tab's navigation, loading, failing, retrying, and
 * running one write at a time.
 */

import type { ReactNode } from "react";

/**
 * One write the panel may ask the host to perform.
 * @returns the document as it now stands, unvalidated.
 */
export type PanelWrite<TParams> = (params: TParams) => Promise<unknown>;

/** What the shared body hands to a provider's view. */
export interface PanelActions<TParams> {
	/** Whether a write is running; every control is disabled while it is. */
	readonly busy: boolean;
	/** Run one write; the answer replaces what the panel shows. */
	run(write: PanelWrite<TParams>): void;
}

/** What one provider's view is handed. */
export interface PanelViewProps<TData, TParams> {
	/** The document the host answered with, already narrowed. */
	readonly data: TData;
	/** What the panel was opened on. */
	readonly params: TParams;
	readonly actions: PanelActions<TParams>;
}

/** Everything the shared panel needs from one integration's own plugin. */
export interface PanelProvider<TData, TParams> {
	/** What the panel says when it was opened without a target. */
	readonly emptyMessage: string;
	/** Narrow the tab's navigation parameters. */
	parseParams(value: unknown): TParams | undefined;
	/** Stable identity of one navigation; the body refetches when it changes. */
	identity(params: TParams): string;
	/** What the tab chip says, or undefined to keep the tab's own title. */
	title(params: TParams): string | undefined;
	/** Read the document off the host, before validation. */
	fetch(params: TParams, signal?: AbortSignal): Promise<unknown>;
	/** Narrow the document; undefined means this version cannot draw it. */
	parse(value: unknown): TData | undefined;
	/** Render the loaded document. */
	view(props: PanelViewProps<TData, TParams>): ReactNode;
}

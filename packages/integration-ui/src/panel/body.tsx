/**
 * The shared side-panel body.
 *
 * The body is a right-Sidebar tab of the integration's own kind, so it renders
 * inside the harness's panel and follows its theme. It reads what to show from
 * its tab's navigation parameters — the Sidebar hands those to every body — and
 * fetches the document through the plugin's own host route, because only the
 * host half holds the MCP connection.
 *
 * Writes are the same channel, one step at a time: run it, and the host answers
 * with the document as it now stands, so the panel never renders an assumption
 * about what a change did.
 */

import {
	Button,
	MarkdownDelegateProvider,
	StateDot,
	TextShimmer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as styles from "../styles/styles.css";
import type { PanelActions, PanelProvider, PanelWrite } from "./types";

/** What the panel currently knows. */
type Load<TData, TParams> =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly data: TData; readonly params: TParams }
	| { readonly status: "error"; readonly message: string };

/** The reason inside an unknown thrown value, as a sentence. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Build the body seat for one integration.
 * @param provider - everything that is the integration's rather than the body's.
 * @returns the component the plugin registers under its own tab id.
 */
export const createPanelBody = <TData, TParams>(
	provider: PanelProvider<TData, TParams>,
): ((props: PropsRuntime<"sidebar.right.pane.tab">) => ReactNode) => {
	const Panel = (props: PropsRuntime<"sidebar.right.pane.tab">): ReactNode => {
		const { tab } = props.useTabInfo();
		const params = provider.parseParams(tab.navigation.params);
		const revision = tab.navigation.revision;
		const identity = params === undefined ? "" : provider.identity(params);

		const [load, setLoad] = useState<Load<TData, TParams>>({
			status: "loading",
		});
		const [failure, setFailure] = useState<string | undefined>(undefined);
		const [busy, setBusy] = useState(false);

		// The effect below is keyed by identity, so the fetch reads the target from a
		// ref rather than closing over one render's copy of it.
		const current = useRef<TParams | undefined>(params);
		current.current = params;

		const fetchPanel = useCallback(
			async (signal?: AbortSignal): Promise<void> => {
				const wanted = current.current;

				if (wanted === undefined) {
					setLoad({ status: "error", message: provider.emptyMessage });
					return;
				}

				setLoad({ status: "loading" });

				try {
					const data = provider.parse(await provider.fetch(wanted, signal));

					if (data === undefined)
						throw new Error(
							"the host answered with a document this version cannot draw",
						);
					if (signal?.aborted !== true)
						setLoad({ status: "ready", data, params: wanted });
				} catch (error) {
					if (signal?.aborted !== true)
						setLoad({ status: "error", message: messageOf(error) });
				}
			},
			[],
		);

		// `identity` is what to show and `revision` is "navigated again"; the fetch
		// reads the target from a ref, so the effect body names neither of them.
		// biome-ignore lint/correctness/useExhaustiveDependencies: both key the refetch
		useEffect(() => {
			const controller = new AbortController();
			setFailure(undefined);
			void fetchPanel(controller.signal);

			return () => {
				controller.abort();
			};
		}, [identity, revision, fetchPanel]);

		/** One write, then the truth about what it did. */
		const run = useCallback(
			(write: PanelWrite<TParams>): void => {
				const wanted = current.current;
				if (wanted === undefined) return;

				setBusy(true);
				setFailure(undefined);

				write(wanted)
					.then((answer) => {
						const data = provider.parse(answer);

						if (data === undefined)
							throw new Error(
								"the host answered with a document this version cannot draw",
							);
						setLoad({ status: "ready", data, params: wanted });
					})
					.catch((error: unknown) => {
						setFailure(messageOf(error));
						// The write may have failed after the host changed nothing; asking
						// again is what tells the two apart.
						void fetchPanel();
					})
					.finally(() => {
						setBusy(false);
					});
			},
			[fetchPanel],
		);

		const actions: PanelActions<TParams> = { busy, run };

		return (
			<div className={styles.panel}>
				<div className={styles.panelScroll}>
					{load.status === "loading" ? (
						<div
							className={styles.panelLoading}
							role="status"
							aria-live="polite"
						>
							<StateDot state="ongoing" size={20} />

							<TextShimmer active>Loading…</TextShimmer>
						</div>
					) : null}

					{load.status === "error" ? (
						<>
							<p className={styles.error}>{load.message}</p>
							<div className={styles.actions}>
								<Button size="sm" onClick={() => void fetchPanel()}>
									Try again
								</Button>
							</div>
						</>
					) : null}

					{failure === undefined ? null : (
						<p className={styles.error}>{failure}</p>
					)}

					{load.status === "ready" ? (
						<MarkdownDelegateProvider
							// Markdown links belong to the browser: a click here must not
							// navigate the panel itself away from the harness.
							openExternalLink={(href) => {
								window.open(href, "_blank", "noopener,noreferrer");
							}}
						>
							{provider.view({
								data: load.data,
								params: load.params,
								actions,
							})}
						</MarkdownDelegateProvider>
					) : null}
				</div>
			</div>
		);
	};

	return Panel;
};

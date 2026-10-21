/**
 * The one Integrations page.
 *
 * It is the only page this suite puts in Settings: the navigation lists it once,
 * and the integrations themselves are tabs inside it. That is what keeps five
 * connection cards from becoming five entries in the sidebar of a dialog, and it
 * is why the page owns so little — the heading, the strip, and the panel the
 * selected tab is rendered into.
 *
 * The strip is built the way the harness builds its own tabbed settings section,
 * down to the underline and the arrow-key walk: one page, one row of tabs, and
 * the tabs that were visited stay mounted so a form does not lose its draft when
 * the user looks at another integration.
 */

import type {
	PropsRenderSlots,
	SnapshotSelectorHook,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import * as styles from "../styles/styles.css";
import type { IntegrationTab } from "../tabs";

interface Props {
	/** Renders the selected integration's card, declared by this registration. */
	readonly renderSlot: PropsRenderSlots<"integrations.tab">["renderSlot"];
	/** The live tab strip, read from the `integrations.tab` ledger. */
	readonly useTabs: SnapshotSelectorHook<readonly IntegrationTab[]>;
}

/** The page: a heading, a strip of integrations, and the selected one's card. */
export const IntegrationsSection = ({
	renderSlot,
	useTabs,
}: Props): ReactNode => {
	const tabsId = useId();
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const tabs = useTabs((value) => value);
	const [chosenId, setChosenId] = useState<string | undefined>(undefined);
	const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	// A tab that leaves while it is selected — its plugin was turned off — hands
	// the strip to the first one left rather than emptying the page.
	const activeId = tabs.find((tab) => tab.id === chosenId)?.id ?? tabs[0]?.id;
	const only = tabs.length === 1 ? tabs[0] : undefined;

	useEffect(() => {
		if (activeId === undefined) return;

		setVisitedIds((previous) =>
			previous.has(activeId) ? previous : new Set([...previous, activeId]),
		);
	}, [activeId]);

	return (
		<div className={styles.section}>
			<h2 className={styles.heading}>Integrations</h2>

			<p className={styles.intro}>
				Connect the outside systems your agent may work with, and see what each
				connection publishes.
			</p>

			{tabs.length === 0 ? (
				<p className={styles.empty}>
					No integration is installed. Install one as a plugin, and its settings
					appear on this page.
				</p>
			) : only !== undefined ? (
				<div className={styles.panel}>
					{renderSlot("integrations.tab", {}, { only: only.id })}
				</div>
			) : (
				<>
					<div className={styles.tabs} role="tablist" aria-label="Integrations">
						{tabs.map((tab, index) => {
							const selected = tab.id === activeId;

							return (
								<button
									key={tab.id}
									ref={(element) => {
										tabRefs.current[index] = element;
									}}
									id={`${tabsId}-tab-${tab.id}`}
									type="button"
									role="tab"
									className={styles.tab}
									aria-selected={selected}
									aria-controls={`${tabsId}-panel-${tab.id}`}
									data-active={selected ? "true" : undefined}
									tabIndex={selected ? 0 : -1}
									onClick={() => {
										setChosenId(tab.id);
									}}
									onKeyDown={(event) => {
										let next: number;

										switch (event.key) {
											case "ArrowRight":
												next = (index + 1) % tabs.length;
												break;
											case "ArrowLeft":
												next = (index - 1 + tabs.length) % tabs.length;
												break;
											case "Home":
												next = 0;
												break;
											case "End":
												next = tabs.length - 1;
												break;
											default:
												return;
										}

										event.preventDefault();

										const wanted = tabs[next];
										if (wanted === undefined) return;

										setChosenId(wanted.id);
										tabRefs.current[next]?.focus();
									}}
								>
									{tab.label}
								</button>
							);
						})}
					</div>

					{tabs
						.filter((tab) => tab.id === activeId || visitedIds.has(tab.id))
						.map((tab) => (
							<div
								key={tab.id}
								id={`${tabsId}-panel-${tab.id}`}
								role="tabpanel"
								aria-labelledby={`${tabsId}-tab-${tab.id}`}
								hidden={tab.id !== activeId}
								className={styles.panel}
							>
								{renderSlot("integrations.tab", {}, { only: tab.id })}
							</div>
						))}
				</>
			)}
		</div>
	);
};

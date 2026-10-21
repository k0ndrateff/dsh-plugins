/**
 * The Integrations page's tab strip, as a value.
 *
 * The strip is drawn from the `integrations.tab` ledger rather than from a list
 * kept beside it, so a plugin that is turned off takes its tab away and the page
 * left behind still knows what it has. Projecting the ledger into rows is a pure
 * step, which is what this module owns; the subscription that keeps the strip
 * current belongs to the registration that reads it.
 */

import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";

/** One tab: what it is called, and the key its panel is dispatched by. */
export interface IntegrationTab {
	/** The registrant's own key, and the id of its tab. */
	readonly id: string;
	/** Its place in the strip, ascending. */
	readonly order: number;
	/** The tab's text, already resolved from whatever the registrant declared. */
	readonly label: string;
}

/**
 * Project the ledger into the strip's rows.
 * @param entries - the live contributions, in ledger order.
 * @returns the rows by ascending `order`, ties keeping registration order. A
 * registration without an id cannot be dispatched to, so it is left out.
 */
export const integrationTabs = (
	entries: readonly StoredEntry[],
): readonly IntegrationTab[] =>
	entries
		.map((entry) => ({
			id: entry.options.id ?? "",
			order: entry.options.order ?? 0,
			label: resolveSlotLabel(entry.options.label) ?? "",
		}))
		.filter((tab) => tab.id !== "")
		.sort((left, right) => left.order - right.order);

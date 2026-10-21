/**
 * The seat one integration's settings card occupies.
 *
 * This suite shows one Settings page rather than five: `dsh-integrations-plugin`
 * owns the page and declares `integrations.tab`, and each integration registers
 * the card for its own provider into it. The contract lives here, in the library
 * every integration already depends on, so four plugins name one slot instead of
 * inventing one each.
 *
 * The tab's copy is the registering plugin's, `label` included: the page renders
 * whatever the ledger says, resolved at read time, so a label declared as a thunk
 * follows the active locale without re-registering.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {
	PropsRuntime,
	SlotComponent,
} from "@deepseek-ai/dsh-client-ui-slots";

declare module "@deepseek-ai/dsh-client-ui-slots" {
	interface SlotMap {
		/**
		 * One integration's card inside the shared Integrations settings page.
		 *
		 * `id` is the tab key and what the page dispatches by, `order` its place
		 * in the strip, and `label` the tab's text.
		 */
		"integrations.tab": {
			kind: "list";
			scope: "root";
		};
	}
}

/** What one integration contributes to the shared page. */
export interface IntegrationsTabSpec {
	/** The integration's key: the tab's id, and what the page dispatches by. */
	readonly id: string;
	/** Its place in the strip, ascending. */
	readonly order: number;
	/** The tab's text, or a thunk read per render for one that follows a locale. */
	readonly label: string | (() => string);
}

/**
 * Register one integration's card into the shared Integrations page.
 *
 * The registration waits for the page to be composed, so a build without
 * `dsh-integrations-plugin` leaves the integration's own tools working and its
 * card simply nowhere to appear — never a plugin that fails to activate.
 * @param ctx - the plugin's own client context.
 * @param spec - the tab's identity in the strip.
 * @param card - the card the tab shows.
 */
export const registerIntegrationsTab = (
	ctx: Context,
	spec: IntegrationsTabSpec,
	card: SlotComponent<PropsRuntime<"integrations.tab">>,
): void => {
	ctx.slots.inject("integrations.tab", () =>
		ctx.slots.register(
			{
				name: "integrations.tab",
				id: spec.id,
				order: spec.order,
				label: spec.label,
			},
			card,
		),
	);
};

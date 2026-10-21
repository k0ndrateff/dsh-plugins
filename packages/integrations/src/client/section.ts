/**
 * Registration of the one Integrations page.
 *
 * The page is registered the way the harness registers its own tabbed settings
 * section: into `settings.section`, declaring `integrations.tab` as a child slot
 * and projecting that slot's ledger into the strip through an injected hook. The
 * ledger read is cached against the slot's version, so a tab that is registered
 * or withdrawn while another one is open redraws the strip without touching the
 * mounted cards.
 *
 * `dsh-integration-ui` owns the `integrations.tab` contract; this module owns
 * the one registration that declares it. A page that nobody integrates with
 * still renders, and says so.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { IntegrationsSection } from "./components/section";
import { type IntegrationTab, integrationTabs } from "./tabs";

/** Where the page sits among the other Settings entries. */
const SECTION_ORDER = 20;

/** The child slot every integration registers its card into. */
const TAB_SLOT = "integrations.tab";

/**
 * Contribute the Integrations page to Settings.
 * @param ctx - the browser context, carrying the slot registry.
 */
export const registerIntegrationsSection = (ctx: Context): void => {
	// The version is the cache key: the ledger is read only when it moved.
	let version = -1;
	let rows: readonly IntegrationTab[] = [];

	ctx.slots.inject("settings.section", () =>
		ctx.slots.register(
			{
				name: "settings.section",
				id: "integrations",
				order: SECTION_ORDER,
				label: () => "Integrations",
				inject: () => ({
					hooks: {
						tabs: {
							getSnapshot: () => {
								const current = ctx.slots.getVersion(TAB_SLOT);

								if (current !== version) {
									version = current;
									rows = integrationTabs(ctx.slots.entries(TAB_SLOT));
								}

								return rows;
							},
							subscribe: (listener: () => void) =>
								ctx.slots.subscribe(TAB_SLOT, listener),
						},
					},
				}),
				// Declaring the child slot is what authorizes the page to render it,
				// and what every integration's `ctx.slots.inject` waits for.
				children: { [TAB_SLOT]: { kind: "list", scope: "root" } },
			},
			IntegrationsSection,
		),
	);
};

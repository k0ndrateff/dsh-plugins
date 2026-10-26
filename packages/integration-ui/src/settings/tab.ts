/**
 * The seat one integration's settings card occupies.
 *
 * This suite shows one Settings page rather than five when
 * `dsh-integrations-plugin` is installed: that page declares `integrations.tab`,
 * and each integration registers the card for its own provider into it. The
 * contract lives here, in the library every integration already depends on, so
 * four plugins name one slot instead of inventing one each.
 *
 * Installing one integration bundle alone must not leave its card nowhere to
 * appear. So the same registration also offers a fallback: when no page exists
 * by the time the client has composed, the card becomes its own top-level
 * Settings section. A page that arrives later removes the fallback, which is why
 * the check waits a beat instead of deciding at activation order.
 *
 * The tab's copy is the registering plugin's, `label` included: the page renders
 * whatever the ledger says, resolved at read time, so a label declared as a thunk
 * follows the active locale without re-registering.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {
	PropsRuntime,
	SlotComponent,
} from "@deepseek-ai/dsh-client-ui-slots";
import { createElement, type ReactNode } from "react";

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

/** How long to wait for the shared page before offering a standalone card. */
const FALLBACK_DELAY_MS = 150;

/** Whether the client has composed the shared Integrations page. */
const hasIntegrationsPage = (ctx: Context): boolean =>
	ctx.slots
		.entries("settings.section")
		.some((entry) => entry.options.id === "integrations");

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
 * The registration waits for the page to be composed and, when the deployment
 * has no page, offers the card as a top-level Settings section instead. A real
 * page that arrives later takes the fallback away, so the two never show the
 * same card twice.
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

	ctx.slots.inject("settings.section", () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let unsubscribe: (() => void) | undefined;
		let fallback: (() => void) | undefined;

		const removeFallback = (): void => {
			unsubscribe?.();
			unsubscribe = undefined;
			fallback?.();
			fallback = undefined;
		};

		// The page and the integrations activate in profile order, so a synchronous
		// check would always miss a page that is mounted after this plugin. One beat
		// is enough for the loader to compose the row; the subscription then handles
		// a page the deployment adds later.
		timer = setTimeout(() => {
			timer = undefined;

			if (hasIntegrationsPage(ctx)) return;

			const Standalone = (): ReactNode => {
				const Card = card as unknown as () => ReactNode;

				return createElement(Card);
			};

			fallback = ctx.slots.register(
				{
					name: "settings.section",
					id: `integration-${spec.id}`,
					order: spec.order,
					label: spec.label,
				},
				Standalone,
			);

			unsubscribe = ctx.slots.subscribe("settings.section", () => {
				if (hasIntegrationsPage(ctx)) removeFallback();
			});
		}, FALLBACK_DELAY_MS);

		return () => {
			if (timer !== undefined) clearTimeout(timer);
			removeFallback();
		};
	});
};

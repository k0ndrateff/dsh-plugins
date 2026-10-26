/**
 * Offline checks for the settings seat.
 *
 * The registration is the one place that decides where an integration's card
 * lives: in the shared page when the deployment has one, and as its own Settings
 * section when a single bundle is installed alone. These checks drive the seat
 * with a fake slot registry, because that decision is about registration, not
 * about rendering.
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import { registerIntegrationsTab } from "../src/settings/tab";

/** One registration the fake registry accepted. */
interface Registered {
	readonly slot: string;
	readonly id: string;
	readonly order: number | undefined;
}

/** A slot registry with the two seats this module touches. */
const harness = (pagePresent: boolean) => {
	const registered: Registered[] = [];
	const entries = new Map<string, { options: { id?: string } }[]>();

	if (pagePresent)
		entries.set("settings.section", [{ options: { id: "integrations" } }]);

	const ctx = {
		slots: {
			inject: (slot: string, callback: () => unknown) => {
				if (slot === "settings.section") callback();

				return () => undefined;
			},
			register: (
				options: { name: string; id: string; order?: number },
				_component: unknown,
			) => {
				registered.push({
					slot: options.name,
					id: options.id,
					order: options.order,
				});
				const list = entries.get(options.name) ?? [];
				list.push({ options: { id: options.id } });
				entries.set(options.name, list);

				return () => undefined;
			},
			entries: (slot: string) => entries.get(slot) ?? [],
			subscribe: () => () => undefined,
		},
	} as unknown as Context;

	return { ctx, registered };
};

test("a single bundle gets its own Settings section", async () => {
	const { ctx, registered } = harness(false);

	registerIntegrationsTab(
		ctx,
		{ id: "sentry", order: 20, label: "Sentry" },
		(() => undefined) as never,
	);

	await new Promise((resolve) => setTimeout(resolve, 220));

	const fallback = registered.find(
		(entry) => entry.id === "integration-sentry",
	);

	expect(
		fallback?.slot === "settings.section" && fallback.order === 20,
		`the card becomes a top-level Settings section — ${JSON.stringify(registered)}`,
	).toBe(true);
	expect(
		registered.some((entry) => entry.slot === "integrations.tab"),
		"the shared-page tab is not registered when there is no page",
	).toBe(false);
});

test("the shared page keeps the card out of the top-level sections", async () => {
	const { ctx, registered } = harness(true);

	registerIntegrationsTab(
		ctx,
		{ id: "sentry", order: 20, label: "Sentry" },
		(() => undefined) as never,
	);

	await new Promise((resolve) => setTimeout(resolve, 220));

	expect(
		registered.some((entry) => entry.id === "integration-sentry"),
		`no fallback section appears — ${JSON.stringify(registered)}`,
	).toBe(false);
});

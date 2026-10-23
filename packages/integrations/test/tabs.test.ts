/**
 * Offline checks for the Integrations page's tab strip.
 *
 * What matters here is the projection: which row a ledger produces, in which
 * order, and what a registration that declared only a string label shows. The
 * subscription and the rendering need a browser and are proved by the page
 * itself.
 */

import { describe, expect, test } from "bun:test";
import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import { integrationTabs } from "../src/client/tabs";

/** One registration, as the slot core stores it. */
function entry(
	id: string | undefined,
	order: number | undefined,
	label: string | (() => string) | undefined,
): StoredEntry {
	return {
		component: () => null,
		options: {
			...(id === undefined ? {} : { id }),
			...(order === undefined ? {} : { order }),
			...(label === undefined ? {} : { label }),
		},
	};
}

describe("the Integrations tab strip", () => {
	test("orders rows by ascending order, not by registration order", () => {
		expect(
			integrationTabs([
				entry("sentry", 20, "Sentry"),
				entry("atlassian", 10, "Atlassian"),
				entry("gitlab", 15, "GitLab"),
			]).map((tab) => tab.id),
		).toEqual(["atlassian", "gitlab", "sentry"]);
	});

	test("keeps a registration without an order at the head", () => {
		expect(
			integrationTabs([entry("a", undefined, "A"), entry("b", 5, "B")]).map(
				(tab) => tab.id,
			),
		).toEqual(["a", "b"]);
	});

	test("reads a label declared as a thunk at projection time", () => {
		expect(
			integrationTabs([entry("atlassian", 10, () => "Integrations")])[0]?.label,
		).toBe("Integrations");
	});

	test("still yields a dispatchable row for a registration with no label", () => {
		expect(integrationTabs([entry("figma", 10, undefined)])[0]?.label).toBe("");
	});

	test("leaves out a registration the strip cannot dispatch to", () => {
		expect(
			integrationTabs([
				entry(undefined, 10, "Nowhere"),
				entry("digest", 30, "Digest"),
			]),
		).toHaveLength(1);
	});
});

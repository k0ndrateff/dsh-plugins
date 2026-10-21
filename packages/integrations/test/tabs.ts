/**
 * Offline checks for the Integrations page's tab strip.
 *
 * What matters here is the projection: which row a ledger produces, in which
 * order, and what a registration that declared only a string label shows. The
 * subscription and the rendering need a browser and are proved by the page
 * itself.
 *
 *   bun run test/tabs.ts
 */

import type { StoredEntry } from "@deepseek-ai/dsh-client-ui-slots";
import { integrationTabs } from "../src/client/tabs";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

check(
	"rows come out by ascending order, not by registration order",
	integrationTabs([
		entry("sentry", 20, "Sentry"),
		entry("atlassian", 10, "Atlassian"),
		entry("gitlab", 15, "GitLab"),
	])
		.map((tab) => tab.id)
		.join(",") === "atlassian,gitlab,sentry",
);

check(
	"a registration without an order keeps the head of the strip",
	integrationTabs([entry("a", undefined, "A"), entry("b", 5, "B")])
		.map((tab) => tab.id)
		.join(",") === "a,b",
);

check(
	"a label declared as a thunk is read at projection time",
	integrationTabs([entry("atlassian", 10, () => "Integrations")])[0]?.label ===
		"Integrations",
);

check(
	"a registration with no label still yields a dispatchable row",
	integrationTabs([entry("figma", 10, undefined)])[0]?.label === "",
);

check(
	"a registration the strip cannot dispatch to is left out",
	integrationTabs([
		entry(undefined, 10, "Nowhere"),
		entry("digest", 30, "Digest"),
	]).length === 1,
);

check(
	"an empty ledger is an empty strip, not an error",
	integrationTabs([]).length === 0,
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

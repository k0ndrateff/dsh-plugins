/**
 * The one bundle this package is: which plugins it mounts, and whether that list
 * still matches what it depends on.
 *
 * The whole file is a drift guard. A bundle that forgets a row silently ships a
 * plugin the user installed and cannot use; a row for a package that is not a
 * dependency installs nothing at all. Neither shows up in a build, because there
 * is nothing here to build.
 *
 *   bun run test/patch.ts
 */

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** This package's own root. */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The monorepo root, where the sibling packages live. */
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));

/** One row the patch inserts. */
interface Row {
	readonly id?: unknown;
	readonly name?: unknown;
}

/** Read one JSON document, or nothing when it is not there. */
function json(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

const own = json(`${ROOT}package.json`) ?? {};
const patch = Bun.YAML.parse(readFileSync(`${ROOT}cordis.patch.yml`, "utf8"));

/** Every bundle package in the monorepo, by package name. */
const bundles = new Map<string, string>();

for await (const path of glob("packages/*/package.json", { cwd: PACKAGES })) {
	const manifest = json(`${PACKAGES}${path}`);
	const name = manifest?.name;
	const dsh = manifest?.dsh as { bundle?: { patch?: unknown } } | undefined;

	if (typeof name === "string" && typeof dsh?.bundle?.patch === "string")
		bundles.set(name, path.replace(/\/package\.json$/u, ""));
}

const entries = Array.isArray(patch) ? patch : [];
const insert = (entries[0] as { insert?: unknown } | undefined)?.insert;
const rows: Row[] = Array.isArray(insert) ? (insert as Row[]) : [];
const names = rows
	.map((row) => row.name)
	.filter((name): name is string => typeof name === "string");
const ids = rows
	.map((row) => row.id)
	.filter((id): id is string => typeof id === "string");
const dependencies = Object.keys(
	(own.dependencies as Record<string, string> | undefined) ?? {},
);

console.log("\n=== the patch ===");
check(
	"one layer, one insert list",
	entries.length === 1 && rows.length > 0,
	`${String(entries.length)} entries, ${String(rows.length)} rows`,
);
check(
	"every row names a package and an id",
	rows.length === names.length && rows.length === ids.length,
	JSON.stringify(rows),
);
check(
	"no two rows share an id",
	new Set(ids).size === ids.length,
	ids.join(", "),
);
check(
	"every row mounts a package that is a bundle",
	names.every((name) => bundles.has(name)),
	names.filter((name) => !bundles.has(name)).join(", "),
);

console.log("\n=== the dependencies ===");
check(
	"every mounted package is a dependency, so installing this installs it",
	names.every((name) => dependencies.includes(name)),
	names.filter((name) => !dependencies.includes(name)).join(", "),
);
check(
	"and every dependency is mounted, so none is installed for nothing",
	dependencies.length > 0 &&
		dependencies.every((name) => names.includes(name)) &&
		dependencies.every((name) => bundles.has(name)),
	dependencies.filter((name) => !names.includes(name)).join(", "),
);
check(
	"this bundle mounts the rest, not itself",
	!names.includes(String(own.name)) && !dependencies.includes(String(own.name)),
	String(own.name),
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

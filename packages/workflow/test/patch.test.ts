/**
 * The one bundle this package is: which plugins it mounts, and whether that list
 * still matches what it depends on.
 *
 * The whole file is a drift guard. A bundle that forgets a row silently ships a
 * plugin the user installed and cannot use; a row for a package that is not a
 * dependency installs nothing at all. Neither shows up in a build, because there
 * is nothing here to build.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
const self = String(own.name);

describe("the patch", () => {
	test("has one layer and one insert list", () => {
		expect(entries).toHaveLength(1);
		expect(rows.length).toBeGreaterThan(0);
	});

	test("every row names a package and an id", () => {
		expect(names).toHaveLength(rows.length);
		expect(ids).toHaveLength(rows.length);
	});

	test("no two rows share an id", () => {
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("every row mounts a package that is a bundle", () => {
		expect(names.filter((name) => !bundles.has(name))).toEqual([]);
	});

	test("every other bundle in the repository is mounted", () => {
		const unmounted = [...bundles.keys()].filter(
			(name) => name !== self && !names.includes(name),
		);

		expect(unmounted).toEqual([]);
	});
});

describe("the dependencies", () => {
	test("every mounted package is a dependency, so installing this installs it", () => {
		expect(names.filter((name) => !dependencies.includes(name))).toEqual([]);
	});

	test("every dependency is mounted, so none is installed for nothing", () => {
		expect(dependencies.length).toBeGreaterThan(0);
		expect(dependencies.filter((name) => !names.includes(name))).toEqual([]);
		expect(dependencies.filter((name) => !bundles.has(name))).toEqual([]);
	});

	test("mounts the rest, not itself", () => {
		expect(names).not.toContain(self);
		expect(dependencies).not.toContain(self);
	});
});

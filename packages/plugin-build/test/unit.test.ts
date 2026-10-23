/**
 * The shared build against this repository's own packages.
 *
 * The builder's whole risk is drift: a plugin importing a workspace library the
 * map does not alias would silently bundle that library's built `lib/` instead
 * of its source, and a plugin going back to its own stylesheet placeholder would
 * leave the shared one undefined. Both are caught by reading the packages here
 * rather than by running a build, so this file needs no toolchain.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	WORKSPACE_LIBRARY_SPECIFIERS,
	workspaceLibraries,
} from "../src/build.mjs";

/** The monorepo root, which every pattern below is relative to. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Read one repository-relative file. */
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

/** One specifier a source file imports, when it names a workspace library. */
const WORKSPACE_IMPORT = /(?:from\s+|import\(\s*|require\(\s*)"(dsh-[^"]+)"/gu;

/** Every `dsh-*` specifier the packages' sources import, and where. */
const importedSpecifiers = async (): Promise<Map<string, string[]>> => {
	const found = new Map<string, string[]>();

	for await (const path of glob("packages/*/src/**/*.{ts,tsx}", {
		cwd: ROOT,
	})) {
		for (const match of read(path).matchAll(WORKSPACE_IMPORT)) {
			const specifier = match[1];
			if (specifier === undefined) continue;

			found.set(specifier, [...(found.get(specifier) ?? []), path]);
		}
	}

	return found;
};

describe("workspace libraries", () => {
	// Any plugin's build.mjs anchors the same sibling libraries, so the check
	// reads the map exactly as a build does.
	const libraries = workspaceLibraries(
		new URL("../../atlassian/build.mjs", import.meta.url),
	);

	test("every offered specifier resolves to a source file", () => {
		const missing = WORKSPACE_LIBRARY_SPECIFIERS.filter((specifier) => {
			const path = libraries[specifier];

			return path === undefined || !existsSync(path);
		});

		expect(missing).toEqual([]);
	});

	test("the map offers nothing it does not document", () => {
		expect(WORKSPACE_LIBRARY_SPECIFIERS).toHaveLength(
			Object.keys(libraries).length,
		);
	});

	test("no package imports a workspace library the build cannot alias", async () => {
		const imported = await importedSpecifiers();
		const unknown = [...imported.keys()].filter(
			(specifier) => !WORKSPACE_LIBRARY_SPECIFIERS.includes(specifier),
		);

		expect(imported.size).toBeGreaterThan(0);
		expect(unknown).toEqual([]);
	});
});

describe("the stylesheet placeholder", () => {
	test("no plugin declares a stylesheet placeholder of its own", async () => {
		const own = new Set<string>();

		for await (const path of glob("packages/*/build.mjs", { cwd: ROOT })) {
			for (const match of read(path).matchAll(/__DSH_[A-Z0-9_]+_STYLES__/gu))
				own.add(`${path}: ${match[0]}`);
		}

		expect([...own]).toEqual([]);
	});

	test("the packages that draw anything install the shared placeholder", async () => {
		const runtimes: string[] = [];

		for await (const path of glob(
			"packages/*/src/client/styles/styles-runtime.ts",
			{ cwd: ROOT },
		))
			runtimes.push(path);

		expect(runtimes.length).toBeGreaterThan(0);

		for (const path of runtimes)
			expect(read(path), path).toContain("__DSH_STYLES__");
	});
});

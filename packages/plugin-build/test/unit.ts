/**
 * The shared build against this repository's own packages.
 *
 * The builder's whole risk is drift: a plugin importing a workspace library the
 * map does not alias would silently bundle that library's built `lib/` instead
 * of its source, and a plugin going back to its own stylesheet placeholder would
 * leave the shared one undefined. Both are caught by reading the packages here
 * rather than by running a build, so this file needs no toolchain.
 *
 *   bun run test/unit.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	WORKSPACE_LIBRARY_SPECIFIERS,
	workspaceLibraries,
} from "../src/build.mjs";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

console.log("\n=== workspace libraries ===");
{
	// Any plugin's build.mjs anchors the same sibling libraries, so the check
	// reads the map exactly as a build does.
	const libraries = workspaceLibraries(
		new URL("../../atlassian/build.mjs", import.meta.url),
	);
	const missing = WORKSPACE_LIBRARY_SPECIFIERS.filter((specifier) => {
		const path = libraries[specifier];

		return path === undefined || !existsSync(path);
	});

	check(
		"every offered specifier resolves to a source file",
		missing.length === 0,
		missing.join(", "),
	);

	check(
		"the map offers nothing it does not document",
		WORKSPACE_LIBRARY_SPECIFIERS.length === Object.keys(libraries).length,
	);

	const imported = await importedSpecifiers();
	const unknown = [...imported.keys()].filter(
		(specifier) => !WORKSPACE_LIBRARY_SPECIFIERS.includes(specifier),
	);

	check(
		"no package imports a workspace library the build cannot alias",
		imported.size > 0 && unknown.length === 0,
		unknown
			.map((specifier) => `${specifier} (${imported.get(specifier)?.[0]})`)
			.join(", "),
	);
}

console.log("\n=== the stylesheet placeholder ===");
{
	const own = new Set<string>();

	for await (const path of glob("packages/*/build.mjs", { cwd: ROOT })) {
		for (const match of read(path).matchAll(/__DSH_[A-Z0-9_]+_STYLES__/gu))
			own.add(`${path}: ${match[0]}`);
	}

	check(
		"no plugin declares a stylesheet placeholder of its own",
		own.size === 0,
		[...own].join(", "),
	);

	const runtimes: string[] = [];

	for await (const path of glob(
		"packages/*/src/client/styles/styles-runtime.ts",
		{ cwd: ROOT },
	))
		runtimes.push(path);

	check(
		"the packages that draw anything install the shared placeholder",
		runtimes.length > 0 &&
			runtimes.every((path) => read(path).includes("__DSH_STYLES__")),
		runtimes
			.filter((path) => !read(path).includes("__DSH_STYLES__"))
			.join(", "),
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

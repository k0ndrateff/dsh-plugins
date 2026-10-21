/**
 * Build the plugin market index the Web Client's Discover tab reads.
 *
 *   bun run market           write docs/market.json
 *   bun run market --check   fail when the committed index is out of date
 *
 * Format 1 of the index is a document DSH validates before it shows anything, so
 * this writes what the validator returns rather than what it built: a file that
 * parses is a file the market can read, and a rule broken here fails the run
 * instead of a user's Discover tab. `@deepseek-ai/dsh-plugin-market-index` is the
 * same validator the harness ships, which is why it is a dependency of this
 * repository rather than a second implementation here.
 *
 * Everything a plugin contributes to the document already lives in its package:
 * the name, the version, the range of harness versions it works with, its
 * description and its icon. What is editorial — the category, the labels, the
 * words somebody would search for — lives in `catalog.mjs` beside this file. The
 * one fact a package cannot know is when its version reached npm, so that is
 * asked of the registry, and the commit that wrote the package answers for a
 * version that is not there yet.
 *
 * The output is `docs/market.json`, which is where GitHub Pages serves it from.
 * It is excluded from the formatter in `biome.json`: the file is a generated
 * document, and reformatting it would only make the next run disagree with it.
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	marketInstallTarget,
	parseMarketIndex,
} from "@deepseek-ai/dsh-plugin-market-index";
import { INDEX, INDEX_URL, PLUGINS } from "./catalog.mjs";

/** The repository root, which every path below is relative to. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Where the index is written, relative to the root. */
const OUTPUT = "docs/market.json";

/** How long one registry lookup may take. */
const REGISTRY_TIMEOUT_MS = 15_000;

/** The MIME type an icon file is served with, by its extension. */
const ICON_TYPES = {
	png: "image/png",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	webp: "image/webp",
	svg: "image/svg+xml",
};

/** How a version's publish time was established, for the run's own report. */
const SOURCES = {
	npm: "published",
	commit: "from the commit that wrote it",
	file: "from the file's own date",
};

/** Read one repository-relative JSON document. */
const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));

/** Every package in the workspace, by name, with where it lives. */
const packages = async () => {
	const found = new Map();

	for await (const path of glob("packages/*/package.json", { cwd: ROOT })) {
		const manifest = json(path);

		found.set(manifest.name, {
			manifest,
			directory: path.replace(/\/package\.json$/u, ""),
		});
	}

	return found;
};

/** When the registry says a version was published, in Unix seconds. */
const fromRegistry = async (name, version) => {
	try {
		const response = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(name)}`,
			{
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
			},
		);

		if (!response.ok) return undefined;

		const document = await response.json();
		const published = document?.time?.[version];
		const seconds =
			typeof published === "string" ? Date.parse(published) / 1000 : Number.NaN;

		return Number.isFinite(seconds) ? Math.floor(seconds) : undefined;
	} catch {
		// An unreachable registry is not a reason to fail: the fallbacks below
		// answer for a version that is not published yet, which is every version
		// before the first release.
		return undefined;
	}
};

/** When the commit that last wrote a package was made, in Unix seconds. */
const fromGit = (directory) => {
	try {
		const seconds = Number(
			execFileSync("git", ["log", "-1", "--format=%ct", "--", directory], {
				cwd: ROOT,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim(),
		);

		return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
	} catch {
		return undefined;
	}
};

/**
 * When a version became available, which is the one fact a package cannot carry.
 *
 * The registry is the only authority on when it was published; a version that is
 * not there yet — everything before a first release — falls back to the commit
 * and then to the file, so the field is never absent.
 */
const publishTimeOf = async (name, version, directory) => {
	const published = await fromRegistry(name, version);

	if (published !== undefined) return { seconds: published, source: "npm" };

	const committed = fromGit(directory);

	if (committed !== undefined) return { seconds: committed, source: "commit" };

	return {
		seconds: Math.floor(
			statSync(`${ROOT}${directory}/package.json`).mtimeMs / 1000,
		),
		source: "file",
	};
};

/** One package's icon, inlined so the index needs no second request. */
const iconOf = ({ manifest, directory }) => {
	if (typeof manifest.icon !== "string") return undefined;

	const path = `${directory}/${manifest.icon.replace(/^\.\//u, "")}`;
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	const type = ICON_TYPES[extension];

	if (type === undefined) throw new Error(`no MIME type for ${path}`);

	return `data:${type};base64,${readFileSync(`${ROOT}${path}`).toString("base64")}`;
};

/** The package's own display text, which its locale file carries. */
const textOf = ({ manifest, directory }) => {
	let meta = {};

	try {
		meta = json(`${directory}/locale/en.json`).meta ?? {};
	} catch {
		// A package without a locale file falls back to its npm description.
	}

	return {
		title: typeof meta.title === "string" ? meta.title : manifest.name,
		description:
			typeof meta.description === "string"
				? meta.description
				: manifest.description,
	};
};

/** The repository an index reader should follow, in the shape the format wants. */
const repositoryOf = (manifest) => {
	const url = manifest.repository?.url;

	if (typeof url !== "string") return undefined;

	return {
		url: url.replace(/^git\+/u, "").replace(/\.git$/u, ""),
		...(typeof manifest.repository.directory === "string"
			? { directory: manifest.repository.directory }
			: {}),
	};
};

/** One plugin's entry in the index, and how its publish time was established. */
const entryOf = async (name, facts) => {
	const { manifest, directory } = facts;
	const text = textOf(facts);
	const icon = iconOf(facts);
	const repository = repositoryOf(manifest);
	const filed = PLUGINS[name];
	const published = await publishTimeOf(name, manifest.version, directory);

	return {
		publishedFrom: published.source,
		entry: {
			name,
			title: text.title,
			...(text.description === undefined
				? {}
				: { description: text.description }),
			...(icon === undefined ? {} : { icon }),
			...(typeof manifest.author === "string"
				? { author: manifest.author }
				: {}),
			...(typeof manifest.homepage === "string"
				? { homepage: manifest.homepage }
				: {}),
			...(repository === undefined ? {} : { repository }),
			metadata: {
				category: filed.category,
				keywords: filed.keywords,
				labels: filed.labels,
			},
			versions: [
				{
					version: manifest.version,
					publishTimestamp: published.seconds,
					source: { type: "npm" },
					...(typeof manifest.engines?.dsh === "string"
						? { engines: { dsh: manifest.engines.dsh } }
						: {}),
				},
			],
		},
	};
};

/**
 * Check that the catalog and the workspace describe the same set of plugins.
 *
 * A bundle nobody filed would be installable but undiscoverable, and a catalog
 * entry for a package that is not a bundle would publish a link that installs
 * nothing. Both are silent failures in a market, so both stop the build.
 */
const checkCoverage = (bundles, catalogued) => {
	const missing = [...bundles].filter((name) => !catalogued.includes(name));
	const extra = catalogued.filter((name) => !bundles.has(name));

	if (missing.length > 0)
		throw new Error(
			`these packages declare a bundle but nothing files them in the catalog: ${missing.join(", ")}`,
		);
	if (extra.length > 0)
		throw new Error(
			`the catalog files packages that are not bundles: ${extra.join(", ")}`,
		);
};

const all = await packages();
const catalogued = Object.keys(PLUGINS);
const bundles = new Set(
	[...all]
		.filter(
			([, facts]) => typeof facts.manifest.dsh?.bundle?.patch === "string",
		)
		.map(([name]) => name),
);

checkCoverage(bundles, catalogued);

const entries = [];
const publishedFrom = new Map();

for (const name of catalogued) {
	const facts = all.get(name);

	if (facts === undefined) throw new Error(`${name} is not in the workspace`);

	const built = await entryOf(name, facts);

	entries.push(built.entry);
	publishedFrom.set(name, built.publishedFrom);
}

const validated = parseMarketIndex(
	{
		format: 1,
		title: INDEX.title,
		...(INDEX.description === undefined
			? {}
			: { description: INDEX.description }),
		metadata: INDEX.metadata,
		plugins: entries,
	},
	INDEX_URL,
);
const text = `${JSON.stringify(validated, null, "\t")}\n`;

if (process.argv.includes("--check")) {
	const committed = existsSync(`${ROOT}${OUTPUT}`)
		? readFileSync(`${ROOT}${OUTPUT}`, "utf8")
		: "";

	if (committed !== text) {
		console.error(
			`[market] ${OUTPUT} is out of date; run \`bun run market\` and commit it`,
		);
		process.exit(1);
	}

	console.log(`[market] ${OUTPUT} is up to date`);
	process.exit(0);
}

mkdirSync(`${ROOT}docs`, { recursive: true });
writeFileSync(`${ROOT}${OUTPUT}`, text);

console.log(
	`[market] ${OUTPUT} written: ${String(validated.plugins.length)} plugins`,
);
for (const plugin of validated.plugins) {
	const version = plugin.versions[0];

	if (version === undefined) continue;

	const from = SOURCES[publishedFrom.get(plugin.name) ?? "file"];

	console.log(
		`[market]   ${plugin.name}@${version.version} (${from}) → ${marketInstallTarget(plugin.name, version).spec}`,
	);
}

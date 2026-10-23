/**
 * The build every plugin in this repository runs.
 *
 * Host half — `lib/index.js`: an ESM bundle the Cordis loader imports. The
 * harness packages it shares with the running installation stay external, as
 * does the MCP SDK, and the workspace libraries are bundled from source, so a
 * build never depends on build order.
 *
 * Browser half — `lib/client.js`: the Web Client loads a plugin's browser half
 * as a classic script that registers a lazy factory on `window.__ModuleLoader__`.
 * The wrapper below is that format: it opens the factory, gives the bundled
 * CommonJS body its own `module`/`exports`, and returns the exports object,
 * which the loader hands to Cordis as the plugin. Only the Web Client's shared
 * module table may stay external — anything else is inlined, because a `require`
 * of an unregistered specifier throws in the page.
 *
 * Styles are authored in vanilla-extract (`*.css.ts`), which compiles them to
 * static CSS at build time. That CSS is compiled in a first pass and inlined
 * into the script in the second, because the client module system serves exactly
 * one artifact per package: a separate stylesheet file would never reach the
 * page. A plugin whose `styles-runtime.ts` reads the `__DSH_STYLES__` placeholder
 * gets that text, whatever the package is called.
 *
 * A package with no `src/client` is host-only, and only the first half is built.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { glob } from "node:fs/promises";
import { vanillaExtractPlugin } from "@vanilla-extract/esbuild-plugin";
import { build, context } from "esbuild";

/** Modules the Web Client seeds into every page (packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"react-dom/client",
	"@deepseek-ai/cordis",
	"zod",
	"@tanstack/react-virtual",
	"@deepseek-ai/dsh-client-store",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-ui-primitives",
	"@deepseek-ai/dsh-client-ui-dockkit",
];

/**
 * Packages the running harness supplies, so the plugin shares their instances.
 *
 * The MCP SDK is a plugin's own dependency rather than the installation's, but
 * the OAuth library reaches it through a dynamic import: bundling it would
 * inline a second copy, so it stays external here too.
 */
const HARNESS_PACKAGES = [
	"@deepseek-ai/dsh-*",
	"@deepseek-ai/cordis",
	"@modelcontextprotocol/client",
];

/** Where the stylesheet pass writes before it is inlined. */
const STYLE_DIR = ".build";

/** The stylesheet placeholder the build substitutes the compiled CSS for. */
const STYLES_DEFINE = "__DSH_STYLES__";

/** The browser half's entry, relative to the package root. */
const CLIENT_ENTRY = "src/client/index.ts";

/** The stylesheet entry, relative to the package root. */
const STYLES_ENTRY = "src/client/styles/styles.css.ts";

/**
 * The workspace libraries a plugin may bundle from source, by specifier.
 *
 * Every entry is offered to every plugin: an alias a plugin never imports costs
 * nothing, and one map means a plugin cannot be built against a stale copy of a
 * library simply because its own build script forgot an entry.
 */
export const WORKSPACE_LIBRARY_SPECIFIERS = [
	"dsh-mcp-oauth",
	"dsh-mcp-oauth/tool-name",
	"dsh-integration-host",
	"dsh-integration-host/correlation",
	"dsh-integration-host/digest",
	"dsh-integration-host/status",
	"dsh-integration-host/shape",
	"dsh-integration-ui",
	"dsh-integration-ui/styles",
];

/** The source file each workspace library specifier stands for, from a plugin root. */
const WORKSPACE_LIBRARY_SOURCES = {
	"dsh-mcp-oauth": "../mcp-oauth/src/index.ts",
	"dsh-mcp-oauth/tool-name": "../mcp-oauth/src/tool-name.ts",
	"dsh-integration-host": "../integration-host/src/index.ts",
	"dsh-integration-host/correlation": "../integration-host/src/correlation.ts",
	"dsh-integration-host/digest": "../integration-host/src/digest.ts",
	"dsh-integration-host/status": "../integration-host/src/status.ts",
	"dsh-integration-host/shape": "../integration-host/src/shape.ts",
	"dsh-integration-ui": "../integration-ui/src/index.ts",
	"dsh-integration-ui/styles": "../integration-ui/src/styles/index.ts",
};

/**
 * Resolve the workspace libraries against one plugin's own root.
 * @param buildUrl - the caller's `import.meta.url`.
 * @returns the specifier-to-path map esbuild takes as `alias`.
 */
export const workspaceLibraries = (buildUrl) =>
	Object.fromEntries(
		Object.entries(WORKSPACE_LIBRARY_SOURCES).map(([specifier, source]) => [
			specifier,
			new URL(source, buildUrl).pathname,
		]),
	);

/**
 * Resolve this build's workspace libraries from source inside vanilla-extract.
 *
 * The plugin compiles every `*.css.ts` with its own esbuild run, which forwards
 * `plugins` but not `alias`. Without this, a stylesheet that imports the shared
 * one would evaluate that package's built bundle instead of its source, and
 * inline a second copy of the vanilla-extract runtime with it.
 */
const workspaceResolver = (libraries) => ({
	name: "workspace-libraries",
	setup(build) {
		build.onResolve({ filter: /^dsh-/ }, (args) => {
			const target = libraries[args.path];

			return target === undefined ? null : { path: target };
		});
	},
});

/** Compile the vanilla-extract stylesheets to one static CSS string. */
const compileStyles = async (libraries) => {
	rmSync(STYLE_DIR, { recursive: true, force: true });
	await build({
		// `styles.css.ts` re-exports the shared stylesheet, so it carries every rule
		// the plugin ships; the components only consume the class names it produces.
		entryPoints: [STYLES_ENTRY],
		outdir: STYLE_DIR,
		entryNames: "styles",
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		alias: libraries,
		plugins: [
			vanillaExtractPlugin({
				outputCss: true,
				identifiers: "short",
				esbuildOptions: { plugins: [workspaceResolver(libraries)] },
			}),
		],
		logLevel: "warning",
	});

	let css = "";
	for await (const file of glob(`${STYLE_DIR}/**/*.css`)) {
		css += readFileSync(file, "utf8");
	}
	rmSync(STYLE_DIR, { recursive: true, force: true });
	if (css === "") throw new Error("vanilla-extract produced no CSS");

	return css;
};

/** The factory wrapper the client module system expects. */
const clientWrapper = (name) => ({
	banner: {
		js:
			`window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {\n` +
			"var module = { exports: {} }; var exports = module.exports;",
	},
	footer: { js: "return module.exports; } });" },
});

/** The host half's build options. */
const hostOptions = (libraries) => ({
	entryPoints: ["src/host/index.ts"],
	outfile: "lib/index.js",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	sourcemap: true,
	external: HARNESS_PACKAGES,
	alias: libraries,
	logLevel: "info",
});

/**
 * The browser half's build options.
 * @param pkg - the plugin's own manifest, for its name and its extra externals.
 * @param css - the compiled stylesheet, inlined into the bundle.
 */
const clientOptions = (pkg, css, libraries) => ({
	entryPoints: [CLIENT_ENTRY],
	outfile: "lib/client.js",
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	jsxDev: false,
	sourcemap: true,
	// React must never be inlined: a second copy breaks hooks in the page.
	external: [...PLATFORM_MODULES, ...(pkg.dsh?.client?.external ?? [])],
	alias: libraries,
	// Class names are still compiled here, but the CSS was collected above and
	// is inlined by `define`, so this pass emits no stylesheet file.
	plugins: [
		vanillaExtractPlugin({
			outputCss: false,
			identifiers: "short",
			esbuildOptions: { plugins: [workspaceResolver(libraries)] },
		}),
	],
	define: {
		"process.env.NODE_ENV": '"production"',
		[STYLES_DEFINE]: JSON.stringify(css),
	},
	...clientWrapper(pkg.name),
	logLevel: "info",
});

/**
 * Build one plugin's halves into its `lib/`.
 *
 * Called from the plugin's own `build.mjs`, which is two lines: the caller's URL
 * is what anchors the package root and the sibling libraries.
 * @param buildUrl - the calling `build.mjs`'s `import.meta.url`.
 * @param options - `watch` holds both halves open and rebuilds on change.
 */
export const buildPlugin = async (buildUrl, options = {}) => {
	const pkg = JSON.parse(
		readFileSync(new URL("./package.json", buildUrl), "utf8"),
	);
	const watch = options.watch ?? process.argv.includes("--watch");
	const libraries = workspaceLibraries(buildUrl);
	const host = hostOptions(libraries);

	if (!existsSync(new URL(CLIENT_ENTRY, buildUrl))) {
		if (!watch) {
			await build(host);
			console.log("[build] lib/index.js written (host-only plugin)");

			return;
		}

		const hostContext = await context(host);
		await hostContext.watch();
		console.log("[build] watching the host half…");

		return;
	}

	const css = await compileStyles(libraries);
	const client = clientOptions(pkg, css, libraries);

	if (watch) {
		const contexts = await Promise.all([context(host), context(client)]);
		await Promise.all(
			contexts.map(async (item) => {
				await item.watch();
			}),
		);
		console.log("[build] watching…");

		return;
	}

	await Promise.all([build(host), build(client)]);
	console.log(
		`[build] lib/index.js and lib/client.js written (${css.length} bytes of CSS inlined)`,
	);
};

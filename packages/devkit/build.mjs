/**
 * Build both halves of the plugin.
 *
 *   node build.mjs [--watch]
 *
 * Host half — `lib/index.js`: an ESM bundle the Cordis loader imports. The
 * harness packages it shares with the running installation stay external.
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
 * page.
 */

import { readFileSync, rmSync } from "node:fs";
import { glob } from "node:fs/promises";
import { vanillaExtractPlugin } from "@vanilla-extract/esbuild-plugin";
import { build, context } from "esbuild";

const pkg = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const watch = process.argv.includes("--watch");

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

/** Packages the running harness supplies, so the plugin shares their instances. */
const HARNESS_PACKAGES = ["@deepseek-ai/dsh-*", "@deepseek-ai/cordis"];

/**
 * Workspace libraries are bundled from source: their code is ours, and a build
 * then never depends on build order.
 */
const WORKSPACE_LIBRARIES = {
	"dsh-integration-host/status": new URL(
		"../integration-host/src/status.ts",
		import.meta.url,
	).pathname,
	"dsh-integration-ui": new URL(
		"../integration-ui/src/index.ts",
		import.meta.url,
	).pathname,
	"dsh-integration-ui/styles": new URL(
		"../integration-ui/src/styles/index.ts",
		import.meta.url,
	).pathname,
};

/**
 * Resolve this build's workspace libraries from source inside vanilla-extract.
 *
 * The plugin compiles every `*.css.ts` with its own esbuild run, which forwards
 * `plugins` but not `alias`. Without this, a stylesheet that imports the shared
 * one would evaluate that package's built bundle instead of its source, and
 * inline a second copy of the vanilla-extract runtime with it.
 */
const workspaceResolver = {
	name: "workspace-libraries",
	setup(build) {
		build.onResolve({ filter: /^dsh-/ }, (args) => {
			const target = WORKSPACE_LIBRARIES[args.path];

			return target === undefined ? null : { path: target };
		});
	},
};

/** Where the stylesheet pass writes before it is inlined. */
const STYLE_DIR = ".build";

/** The factory wrapper the client module system expects. */
const clientWrapper = {
	banner: {
		js:
			`window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\n` +
			"var module = { exports: {} }; var exports = module.exports;",
	},
	footer: { js: "return module.exports; } });" },
};

/** Compile the vanilla-extract stylesheets to one static CSS string. */
async function compileStyles() {
	rmSync(STYLE_DIR, { recursive: true, force: true });
	await build({
		// `styles.css.ts` re-exports the shared stylesheet, so it carries every rule
		// the plugin ships; the components only consume the class names it produces.
		entryPoints: ["src/client/styles/styles.css.ts"],
		outdir: STYLE_DIR,
		entryNames: "styles",
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		alias: WORKSPACE_LIBRARIES,
		plugins: [
			vanillaExtractPlugin({
				outputCss: true,
				identifiers: "short",
				esbuildOptions: { plugins: [workspaceResolver] },
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
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
	entryPoints: ["src/host/index.ts"],
	outfile: "lib/index.js",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	sourcemap: true,
	external: HARNESS_PACKAGES,
	logLevel: "info",
};

/**
 * @param {string} css - the compiled stylesheet, inlined into the bundle.
 * @returns {import('esbuild').BuildOptions}
 */
function clientOptions(css) {
	return {
		entryPoints: ["src/client/index.ts"],
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
		alias: WORKSPACE_LIBRARIES,
		// Class names are still compiled here, but the CSS was collected above and
		// is inlined by `define`, so this pass emits no stylesheet file.
		plugins: [
			vanillaExtractPlugin({
				outputCss: false,
				identifiers: "short",
				esbuildOptions: { plugins: [workspaceResolver] },
			}),
		],
		define: {
			"process.env.NODE_ENV": '"production"',
			__DSH_DEVKIT_STYLES__: JSON.stringify(css),
		},
		...clientWrapper,
		logLevel: "info",
	};
}

if (watch) {
	const css = await compileStyles();
	const contexts = await Promise.all([
		context(hostOptions),
		context(clientOptions(css)),
	]);
	await Promise.all(
		contexts.map(async (ctx) => {
			await ctx.watch();
		}),
	);
	console.log("[build] watching…");
} else {
	const css = await compileStyles();
	await Promise.all([build(hostOptions), build(clientOptions(css))]);
	console.log(
		`[build] lib/index.js and lib/client.js written (${css.length} bytes of CSS inlined)`,
	);
}

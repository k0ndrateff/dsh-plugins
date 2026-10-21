import { readFileSync, rmSync } from "node:fs";
import { glob } from "node:fs/promises";
import { vanillaExtractPlugin } from "@vanilla-extract/esbuild-plugin";
import { build, context } from "esbuild";

const pkg = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const watch = process.argv.includes("--watch");
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
const HARNESS_PACKAGES = ["@deepseek-ai/dsh-*", "@deepseek-ai/cordis"];
const WORKSPACE_LIBRARIES = {
	"dsh-integration-host": new URL(
		"../integration-host/src/index.ts",
		import.meta.url,
	).pathname,
	"dsh-integration-host/digest": new URL(
		"../integration-host/src/digest.ts",
		import.meta.url,
	).pathname,
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
	"dsh-mcp-oauth": new URL("../mcp-oauth/src/index.ts", import.meta.url)
		.pathname,
};
const workspaceResolver = {
	name: "workspace-libraries",
	setup(build) {
		build.onResolve({ filter: /^dsh-/ }, (args) => ({
			path: WORKSPACE_LIBRARIES[args.path],
		}));
	},
};
const compileStyles = async () => {
	rmSync(".build", { recursive: true, force: true });
	await build({
		entryPoints: ["src/client/styles/styles.css.ts"],
		outdir: ".build",
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
	for await (const file of glob(".build/**/*.css"))
		css += readFileSync(file, "utf8");
	rmSync(".build", { recursive: true, force: true });
	if (!css) throw new Error("vanilla-extract produced no CSS");
	return css;
};
const wrapper = {
	banner: {
		js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
	},
	footer: { js: "return module.exports; } });" },
};
const hostOptions = {
	entryPoints: ["src/host/index.ts"],
	outfile: "lib/index.js",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	sourcemap: true,
	external: HARNESS_PACKAGES,
	alias: WORKSPACE_LIBRARIES,
	logLevel: "info",
};
const clientOptions = (css) => ({
	entryPoints: ["src/client/index.ts"],
	outfile: "lib/client.js",
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	jsxDev: false,
	sourcemap: true,
	external: [...PLATFORM_MODULES, ...(pkg.dsh?.client?.external ?? [])],
	alias: WORKSPACE_LIBRARIES,
	plugins: [
		vanillaExtractPlugin({
			outputCss: false,
			identifiers: "short",
			esbuildOptions: { plugins: [workspaceResolver] },
		}),
	],
	define: {
		"process.env.NODE_ENV": '"production"',
		__DSH_DIGEST_STYLES__: JSON.stringify(css),
	},
	...wrapper,
	logLevel: "info",
});
if (watch) {
	const css = await compileStyles();
	const contexts = await Promise.all([
		context(hostOptions),
		context(clientOptions(css)),
	]);
	await Promise.all(contexts.map((item) => item.watch()));
	console.log("[build] watching…");
} else {
	const css = await compileStyles();
	await Promise.all([build(hostOptions), build(clientOptions(css))]);
	console.log(
		`[build] lib/index.js and lib/client.js written (${css.length} bytes of CSS inlined)`,
	);
}

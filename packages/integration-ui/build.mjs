/**
 * Build the library.
 *
 * The bundle is what a consumer installs; during development a plugin bundles
 * this package's source directly (see the alias in its build.mjs), so the two
 * can never disagree about the code. React and the Web Client's shared modules
 * stay external because the page already has exactly one copy of each.
 */
import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts", "src/styles/index.ts"],
	outdir: "lib",
	entryNames: "[dir]/[name]",
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	jsxDev: false,
	sourcemap: true,
	external: [
		"react",
		"react/jsx-runtime",
		"@deepseek-ai/*",
		"dsh-integration-host",
	],
	logLevel: "info",
});

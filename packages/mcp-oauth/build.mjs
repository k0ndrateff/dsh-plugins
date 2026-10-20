/**
 * Build the library.
 *
 * The bundle is what a consumer installs; during development a plugin bundles
 * this package's source directly (see the alias in its build.mjs), so the two
 * can never disagree about the code.
 */
import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts", "src/tool-name.ts"],
	outdir: "lib",
	entryNames: "[name]",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	sourcemap: true,
	external: ["@deepseek-ai/*", "@modelcontextprotocol/client"],
	logLevel: "info",
});

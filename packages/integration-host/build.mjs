/**
 * Build the library.
 *
 * The bundle is what a consumer installs; during development a plugin bundles
 * this package's source directly (see the alias in its build.mjs), so the two
 * can never disagree about the code.
 *
 * `status.ts` is a second entry on purpose: it is the wire contract a browser
 * half reads without pulling this package's node code into its program.
 */
import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts", "src/status.ts"],
	outdir: "lib",
	entryNames: "[name]",
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	sourcemap: true,
	external: ["@deepseek-ai/*", "dsh-mcp-oauth"],
	logLevel: "info",
});

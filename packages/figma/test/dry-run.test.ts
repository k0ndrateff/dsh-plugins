/**
 * The plugin against the running Figma desktop app.
 *
 * This is the spike turned into a check: it opens the real MCP connection to the
 * Dev Mode server, reads a real node, and asks for its real picture. Nothing here
 * is invented, which is why it skips rather than fails when the desktop app is
 * not running — the server only exists while it is.
 *
 * What it proves that the offline checks cannot: the server's tool names, the
 * shape of `get_metadata`'s XML, and that `get_screenshot` really answers an
 * image — the three facts the panel is built on.
 *
 *   bun run test/dry-run.ts
 */

import { expect, test } from "bun:test";
import type { Context } from "@deepseek-ai/cordis";
import { McpBridge } from "dsh-mcp-oauth";
import type { FigmaConfig } from "../src/host/config";
import { PanelApi } from "../src/host/panels/panel";
import { parseMetadata } from "../src/host/presentation/parse";
import { profileOf } from "../src/host/profile";
import { presentTool } from "../src/host/tools/present";

/** How long the whole live check may take. */
const TIMEOUT_MS = 60_000;

/** A harness context with just enough surface for the bridge and its logger. */
function harness(): Context {
	const published: string[] = [];

	return {
		logger: { info: () => {}, warn: () => {} },
		tools: {
			register: (definition: { name: string }) => {
				published.push(definition.name);

				return () => {};
			},
		},
	} as unknown as Context;
}

/** The page the server listed, for a document nothing is selected in. */
const firstPageOf = (text: string): string | undefined =>
	/^- (\d+:\d+):/mu.exec(text)?.[1];

const config: FigmaConfig = {
	endpoint: "http://127.0.0.1:3845/mcp",
	debug: false,
};

const profile = profileOf(config);
const ctx = harness();
const bridge = new McpBridge({
	profile,
	clientInfo: { name: "dsh-figma-dry-run", version: "0.1.0" },
});

const run = process.env.FIGMA_LIVE === "1" ? test : test.skip;

run(
	"the Figma Dev Mode MCP server",
	async () => {
		const ready = await Promise.race([
			bridge.ensure(ctx),
			new Promise<boolean>((resolve) => {
				setTimeout(() => resolve(false), TIMEOUT_MS);
			}),
		]);

		if (!ready) {
			console.log(
				`  skip  the Figma Dev Mode MCP server did not answer at ${config.endpoint}: ${bridge.lastFailure ?? "timed out"}`,
			);
			console.log("\n0/0 checks run (the desktop app is not running)");
			return;
		}

		const names = [...bridge.toolNames];

		expect(
			names.length > 0,
			`the server published its tools — ${`${names.length} tools`}`,
		).toBe(true);

		for (const tool of [
			"get_metadata",
			"get_variable_defs",
			"get_code_connect_map",
			"get_screenshot",
		]) {
			expect(
				names.includes(`mcp__figma__${tool}`),
				String(`it offers ${tool}`) + " — " + names.slice(0, 4).join(", "),
			).toBe(true);
		}

		const panel = new PanelApi({ bridge, ctx });

		/** The answer to `get_metadata` with no node, as the server words it. */
		const listing = await bridge.callTool("get_metadata", {});
		const listingText = (listing.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("\n");

		// With nothing selected the server lists the document's pages; with a selection
		// it answers that selection's own metadata, which is the node the panel would
		// open on. Either is a real target, and which one arrives is the user's business.
		const selected = parseMetadata(listing);
		const target = selected?.root.id ?? firstPageOf(listingText);

		expect(
			target !== undefined,
			`the server answers with the current selection or the document's pages — ${listingText.split("\n")[0]?.slice(0, 60)}`,
		).toBe(true);

		if (target === undefined) {
			return;
		}

		const document = await panel.node({ node: target });

		expect(
			document.node.id === target && document.node.type !== "",
			`the target's metadata is read — ${`${document.node.id} ${document.node.type} ${document.node.width}×${document.node.height}`}`,
		).toBe(true);
		expect(
			document.children.every((child) => child.width >= 0 && child.height >= 0),
			`every layer it lists carries a size — ${`${document.children.length} layers`}`,
		).toBe(true);
		expect(
			document.screenshot?.includes("/dsh-figma/screenshot?node=") === true,
			`the panel is given a route to draw the picture from — ${String(document.screenshot)}`,
		).toBe(true);

		console.log("\n=== a real picture ===");

		const shot = await panel.screenshot(target);

		expect(
			shot.contentType.startsWith("image/"),
			`the server answers an image — ${`${shot.contentType}, ${shot.bytes.byteLength} bytes`}`,
		).toBe(true);
		expect(
			shot.bytes[0] === 0x89 && shot.bytes[1] === 0x50,
			`the bytes are a real image — ${`${shot.bytes[0]} ${shot.bytes[1]}`}`,
		).toBe(true);

		console.log("\n=== the tool on a real node ===");

		const definition = presentTool.create({
			panel,
			imageTool: "mcp__figma__get_screenshot",
		});
		const value = (await definition.execute({ node: target }, {
			callId: "dry-run",
			signal: new AbortController().signal,
			agent: {},
		} as never)) as { summary: string; nodeId: string };

		expect(
			value.nodeId === target,
			"the tool answers about the node it read",
		).toBe(true);
		expect(
			value.summary.includes(target) && value.summary.includes("×"),
			`its summary names the node and its size — ${value.summary.split("\n")[0]}`,
		).toBe(true);
		expect(
			(
				definition.output.presentationMeta?.({}, value as never) as {
					node?: { id?: string };
				}
			)?.node?.id === target,
			"the card carries the same node",
		).toBe(true);

		await bridge.drop();
	},
	120_000,
);

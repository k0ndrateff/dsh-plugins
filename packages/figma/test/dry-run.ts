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

import type { Context } from "@deepseek-ai/cordis";
import { McpBridge } from "dsh-mcp-oauth";
import type { FigmaConfig } from "../src/host/config";
import { PanelApi } from "../src/host/panels/panel";
import { parseMetadata } from "../src/host/presentation/parse";
import { profileOf } from "../src/host/profile";
import { presentTool } from "../src/host/tools/present";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

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

console.log("\n=== the Dev Mode MCP server ===");

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
	process.exit(0);
}

const names = [...bridge.toolNames];

check(
	"the server published its tools",
	names.length > 0,
	`${names.length} tools`,
);

for (const tool of [
	"get_metadata",
	"get_variable_defs",
	"get_code_connect_map",
	"get_screenshot",
]) {
	check(
		`it offers ${tool}`,
		names.includes(`mcp__figma__${tool}`),
		names.slice(0, 4).join(", "),
	);
}

console.log("\n=== a real node ===");

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

check(
	"the server answers with the current selection or the document's pages",
	target !== undefined,
	listingText.split("\n")[0]?.slice(0, 60),
);

if (target === undefined) {
	console.log(`\n${checks - failures}/${checks} checks passed`);
	process.exit(failures > 0 ? 1 : 0);
}

const document = await panel.node({ node: target });

check(
	"the target's metadata is read",
	document.node.id === target && document.node.type !== "",
	`${document.node.id} ${document.node.type} ${document.node.width}×${document.node.height}`,
);
check(
	"every layer it lists carries a size",
	document.children.every((child) => child.width >= 0 && child.height >= 0),
	`${document.children.length} layers`,
);
check(
	"the panel is given a route to draw the picture from",
	document.screenshot?.includes("/dsh-figma/screenshot?node=") === true,
	String(document.screenshot),
);

console.log("\n=== a real picture ===");

const shot = await panel.screenshot(target);

check(
	"the server answers an image",
	shot.contentType.startsWith("image/"),
	`${shot.contentType}, ${shot.bytes.byteLength} bytes`,
);
check(
	"the bytes are a real image",
	shot.bytes[0] === 0x89 && shot.bytes[1] === 0x50,
	`${shot.bytes[0]} ${shot.bytes[1]}`,
);

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

check("the tool answers about the node it read", value.nodeId === target);
check(
	"its summary names the node and its size",
	value.summary.includes(target) && value.summary.includes("×"),
	value.summary.split("\n")[0],
);
check(
	"the card carries the same node",
	(
		definition.output.presentationMeta?.({}, value as never) as {
			node?: { id?: string };
		}
	)?.node?.id === target,
);

await bridge.drop();

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

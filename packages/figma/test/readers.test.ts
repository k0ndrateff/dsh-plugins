/**
 * The Figma readers against recorded shapes.
 *
 * The fixtures follow what the Dev Mode MCP server answered on a live desktop
 * app: `get_metadata` answers XML whose elements are layer types, and the three
 * other tools answer an object keyed by name, an object keyed by node id, and an
 * image block. The names, ids and sizes here are invented — the shapes are the
 * server's, the values are not — and `test/dry-run.ts` is what confirms them
 * against the running app.
 *
 *   bun run test/readers.ts
 */

import { expect, test } from "bun:test";
import {
	parseCodeConnectMap,
	parseMetadata,
	parseNodeRef,
	parseScreenshot,
	parseVariableDefs,
} from "../src/host/presentation/parse";

/** One MCP result, as a tool answers with text. */
const textResult = (text: string): unknown => ({
	content: [{ type: "text", text }],
});

test("a node reference", async () => {
	expect(parseNodeRef("1:2")?.nodeId === "1:2", "an id is read as itself").toBe(
		true,
	);
	expect(
		parseNodeRef("960-6938")?.nodeId === "960:6938",
		"the dash form becomes Figma's own",
	).toBe(true);
	expect(
		parseNodeRef("I123-456;789-12")?.nodeId === "I123:456;789:12",
		"an instance child id keeps its segments",
	).toBe(true);
	expect(
		parseNodeRef(
			"https://www.figma.com/design/AbC123/Storefront?node-id=12-34&t=x",
		)?.nodeId === "12:34" &&
			parseNodeRef(
				"https://www.figma.com/design/AbC123/Storefront?node-id=12-34&t=x",
			)?.fileKey === "AbC123",
		"a design link is read as its node and file",
	).toBe(true);
	expect(
		parseNodeRef(
			"https://www.figma.com/design/AbC123/branch/BrAnCh9/Storefront?node-id=1-2",
		)?.fileKey === "BrAnCh9",
		"a branch link is read as the branch's key",
	).toBe(true);
	expect(
		parseNodeRef("https://www.figma.com/board/BoArD1/Flow?node-id=5-6")
			?.nodeId === "5:6",
		"a board link is read the same way",
	).toBe(true);
	expect(
		parseNodeRef("https://www.figma.com/design/AbC123/Storefront") ===
			undefined,
		"a link without a node names no node",
	).toBe(true);
	expect(
		parseNodeRef("Menu Items") === undefined &&
			parseNodeRef("") === undefined &&
			parseNodeRef("1:2:3") === undefined,
		"anything else is not a node",
	).toBe(true);
});
test("the metadata XML", async () => {
	const METADATA = textResult(
		`<frame id="960:6938" name="Menu Items &amp; more" x="14096" y="2243" width="260" height="502">
  <symbol id="960:6939" name="State=Default" x="20" y="14" width="75" height="40" />
  <symbol id="960:6941" name="State=Hover" x="20" y="54" width="75" height="40">
    <text id="960:6942" name="Menu" x="28" y="62" width="43" height="24" />
  </symbol>
  <symbol id="961:6944" name="State=Desibled" x="20" y="94" width="75" height="40" />
</frame>
IMPORTANT: After you call this tool, you MUST call get_design_context if trying to implement the design.`,
	);

	const metadata = parseMetadata(METADATA);

	expect(
		metadata?.root.id === "960:6938",
		"the root is the element that was asked about",
	).toBe(true);
	expect(
		metadata?.root.type === "frame",
		"its type is the element's own name",
	).toBe(true);
	expect(
		metadata?.root.width === 260 && metadata.root.height === 502,
		"its size is read as numbers",
	).toBe(true);
	expect(
		metadata?.root.x === 14096 && metadata.root.y === 2243,
		"its position is read too",
	).toBe(true);
	expect(
		metadata?.root.name === "Menu Items & more",
		"an escaped name is decoded",
	).toBe(true);
	expect(
		metadata?.children.length === 3,
		"only direct children are listed",
	).toBe(true);
	expect(
		metadata?.children[0]?.id === "960:6939" &&
			metadata.children[0]?.type === "symbol" &&
			metadata.children[0]?.width === 75,
		"a child keeps its own facts",
	).toBe(true);
	expect(
		metadata?.children.some((child) => child.id === "960:6942") === false,
		"a grandchild is not a child",
	).toBe(true);
	expect(
		metadata?.layers === 5,
		"every layer is counted, grandchildren included",
	).toBe(true);
	expect(
		metadata?.children.length === 3,
		"the server's advice after the root is not part of the document",
	).toBe(true);

	const PAGE = textResult(
		`<canvas id="0:1" name="🐋 Components" x="0" y="0" width="0" height="0">
  <frame id="960:6938" name="Menu Items" x="0" y="0" width="260" height="502" />
</canvas>`,
	);

	expect(
		parseMetadata(PAGE)?.root.type === "canvas" &&
			parseMetadata(PAGE)?.children.length === 1,
		"a page is read like any other element",
	).toBe(true);

	expect(
		parseMetadata(
			textResult(
				"No nodeId was provided. Listing the top-level pages of the document.",
			),
		) === undefined,
		"prose is not a document",
	).toBe(true);

	const SELECTED = textResult(
		`Currently selected nodes:
- 5343:22245: Flexible exchange  options

<symbol id="5343:22245" name="Flexible exchange  options" x="0" y="86" width="1200" height="470">
  <frame id="5343:22208" name="Content" x="64" y="149" width="512" height="172" />
</symbol>
IMPORTANT: After you call this tool, you MUST call get_design_context.`,
	);

	expect(
		parseMetadata(SELECTED)?.root.id === "5343:22245" &&
			parseMetadata(SELECTED)?.children.length === 1,
		`a document that opens with the selection notice is still read — ${String(parseMetadata(SELECTED)?.root.id)}`,
	).toBe(true);

	expect(
		parseMetadata({
			content: [{ type: "text", text: "Nothing is selected" }],
			isError: true,
		}) === undefined,
		"an error answer is not a document either",
	).toBe(true);
});
test("the variables a node uses", async () => {
	const VARIABLES = textResult(
		JSON.stringify({
			"8": "8",
			"16": 16,
			"text/primary": "#ffffff",
			"Body/M/Regular":
				'Font(family: "Inter", style: Regular, size: 16, weight: 400, lineHeight: 24, letterSpacing: 0.5)',
		}),
	);

	const tokens = parseVariableDefs(VARIABLES);

	expect(
		tokens.length === 4,
		"every variable is kept, in the server's order",
	).toBe(true);
	expect(
		tokens[0]?.name === "8" && tokens[0]?.value === "8",
		"a name and its value are both text",
	).toBe(true);
	expect(tokens[1]?.value === "16", "a numeric value is rendered as text").toBe(
		true,
	);
	expect(
		tokens[3]?.value.startsWith("Font(family:") === true,
		"a font shorthand survives as one value",
	).toBe(true);
	expect(
		parseVariableDefs(textResult("Nothing is selected")).length === 0,
		"prose names no variables",
	).toBe(true);
	expect(
		parseVariableDefs(textResult("{}")).length === 0,
		"an empty answer names none either",
	).toBe(true);
});
test("the Code Connect map", async () => {
	const MAPPED = textResult(
		JSON.stringify({
			"960:6939": {
				codeConnectSrc: "src/components/menu-item.tsx",
				codeConnectName: "MenuItem",
			},
		}),
	);

	const mappings = parseCodeConnectMap(MAPPED, "960:6939");

	expect(mappings.length === 1, "a mapped node is read").toBe(true);
	expect(
		mappings[0]?.component === "MenuItem" &&
			mappings[0]?.source === "src/components/menu-item.tsx",
		"the component and its source are kept",
	).toBe(true);
	expect(mappings[0]?.nodeId === "960:6939", "the mapping names its node").toBe(
		true,
	);

	const SINGLE = textResult(
		JSON.stringify({
			codeConnectSrc: "https://github.com/acme/ui/blob/main/Button.tsx",
			codeConnectName: "Button",
		}),
	);

	expect(
		parseCodeConnectMap(SINGLE, "12:34")[0]?.nodeId === "12:34",
		"a single mapping answers for the node that was asked about",
	).toBe(true);
	expect(
		parseCodeConnectMap(textResult("{}"), "960:6939").length === 0,
		"an unmapped node maps to nothing",
	).toBe(true);
	expect(
		parseCodeConnectMap(
			textResult(JSON.stringify({ "1:2": { codeConnectName: "Button" } })),
			"1:2",
		).length === 0,
		"a mapping without a source is not a mapping",
	).toBe(true);
});
test("the screenshot", async () => {
	const shot = parseScreenshot({
		content: [
			{ type: "text", text: "Here is the frame" },
			{
				type: "image",
				mimeType: "image/png",
				data: Buffer.from("PNG!").toString("base64"),
			},
		],
	});

	expect(shot?.contentType === "image/png", "the image block is found").toBe(
		true,
	);
	expect(
		Buffer.from(shot?.bytes ?? []).toString("utf8") === "PNG!",
		"its bytes are decoded",
	).toBe(true);
	expect(
		parseScreenshot(textResult("Nothing is selected")) === undefined,
		"an answer with no image has none",
	).toBe(true);
	expect(
		parseScreenshot({ content: [{ type: "image", data: "UE5H" }] })
			?.contentType === "image/png",
		"an image without a media type is still a picture",
	).toBe(true);
});

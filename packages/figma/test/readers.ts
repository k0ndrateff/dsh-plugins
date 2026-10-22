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

import {
	parseCodeConnectMap,
	parseMetadata,
	parseNodeRef,
	parseScreenshot,
	parseVariableDefs,
} from "../src/host/presentation/parse";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** One MCP result, as a tool answers with text. */
const textResult = (text: string): unknown => ({
	content: [{ type: "text", text }],
});

console.log("\n=== a node reference ===");

check("an id is read as itself", parseNodeRef("1:2")?.nodeId === "1:2");
check(
	"the dash form becomes Figma's own",
	parseNodeRef("960-6938")?.nodeId === "960:6938",
);
check(
	"an instance child id keeps its segments",
	parseNodeRef("I123-456;789-12")?.nodeId === "I123:456;789:12",
);
check(
	"a design link is read as its node and file",
	parseNodeRef(
		"https://www.figma.com/design/AbC123/Storefront?node-id=12-34&t=x",
	)?.nodeId === "12:34" &&
		parseNodeRef(
			"https://www.figma.com/design/AbC123/Storefront?node-id=12-34&t=x",
		)?.fileKey === "AbC123",
);
check(
	"a branch link is read as the branch's key",
	parseNodeRef(
		"https://www.figma.com/design/AbC123/branch/BrAnCh9/Storefront?node-id=1-2",
	)?.fileKey === "BrAnCh9",
);
check(
	"a board link is read the same way",
	parseNodeRef("https://www.figma.com/board/BoArD1/Flow?node-id=5-6")
		?.nodeId === "5:6",
);
check(
	"a link without a node names no node",
	parseNodeRef("https://www.figma.com/design/AbC123/Storefront") === undefined,
);
check(
	"anything else is not a node",
	parseNodeRef("Menu Items") === undefined &&
		parseNodeRef("") === undefined &&
		parseNodeRef("1:2:3") === undefined,
);

console.log("\n=== the metadata XML ===");

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

check(
	"the root is the element that was asked about",
	metadata?.root.id === "960:6938",
);
check("its type is the element's own name", metadata?.root.type === "frame");
check(
	"its size is read as numbers",
	metadata?.root.width === 260 && metadata.root.height === 502,
);
check(
	"its position is read too",
	metadata?.root.x === 14096 && metadata.root.y === 2243,
);
check(
	"an escaped name is decoded",
	metadata?.root.name === "Menu Items & more",
);
check("only direct children are listed", metadata?.children.length === 3);
check(
	"a child keeps its own facts",
	metadata?.children[0]?.id === "960:6939" &&
		metadata.children[0]?.type === "symbol" &&
		metadata.children[0]?.width === 75,
);
check(
	"a grandchild is not a child",
	metadata?.children.some((child) => child.id === "960:6942") === false,
);
check("every layer is counted, grandchildren included", metadata?.layers === 5);
check(
	"the server's advice after the root is not part of the document",
	metadata?.children.length === 3,
);

const PAGE = textResult(
	`<canvas id="0:1" name="🐋 Components" x="0" y="0" width="0" height="0">
  <frame id="960:6938" name="Menu Items" x="0" y="0" width="260" height="502" />
</canvas>`,
);

check(
	"a page is read like any other element",
	parseMetadata(PAGE)?.root.type === "canvas" &&
		parseMetadata(PAGE)?.children.length === 1,
);

check(
	"prose is not a document",
	parseMetadata(
		textResult(
			"No nodeId was provided. Listing the top-level pages of the document.",
		),
	) === undefined,
);

const SELECTED = textResult(
	`Currently selected nodes:
- 5343:22245: Flexible exchange  options

<symbol id="5343:22245" name="Flexible exchange  options" x="0" y="86" width="1200" height="470">
  <frame id="5343:22208" name="Content" x="64" y="149" width="512" height="172" />
</symbol>
IMPORTANT: After you call this tool, you MUST call get_design_context.`,
);

check(
	"a document that opens with the selection notice is still read",
	parseMetadata(SELECTED)?.root.id === "5343:22245" &&
		parseMetadata(SELECTED)?.children.length === 1,
	String(parseMetadata(SELECTED)?.root.id),
);

check(
	"an error answer is not a document either",
	parseMetadata({
		content: [{ type: "text", text: "Nothing is selected" }],
		isError: true,
	}) === undefined,
);

console.log("\n=== the variables a node uses ===");

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

check("every variable is kept, in the server's order", tokens.length === 4);
check(
	"a name and its value are both text",
	tokens[0]?.name === "8" && tokens[0]?.value === "8",
);
check("a numeric value is rendered as text", tokens[1]?.value === "16");
check(
	"a font shorthand survives as one value",
	tokens[3]?.value.startsWith("Font(family:") === true,
);
check(
	"prose names no variables",
	parseVariableDefs(textResult("Nothing is selected")).length === 0,
);
check(
	"an empty answer names none either",
	parseVariableDefs(textResult("{}")).length === 0,
);

console.log("\n=== the Code Connect map ===");

const MAPPED = textResult(
	JSON.stringify({
		"960:6939": {
			codeConnectSrc: "src/components/menu-item.tsx",
			codeConnectName: "MenuItem",
		},
	}),
);

const mappings = parseCodeConnectMap(MAPPED, "960:6939");

check("a mapped node is read", mappings.length === 1);
check(
	"the component and its source are kept",
	mappings[0]?.component === "MenuItem" &&
		mappings[0]?.source === "src/components/menu-item.tsx",
);
check("the mapping names its node", mappings[0]?.nodeId === "960:6939");

const SINGLE = textResult(
	JSON.stringify({
		codeConnectSrc: "https://github.com/acme/ui/blob/main/Button.tsx",
		codeConnectName: "Button",
	}),
);

check(
	"a single mapping answers for the node that was asked about",
	parseCodeConnectMap(SINGLE, "12:34")[0]?.nodeId === "12:34",
);
check(
	"an unmapped node maps to nothing",
	parseCodeConnectMap(textResult("{}"), "960:6939").length === 0,
);
check(
	"a mapping without a source is not a mapping",
	parseCodeConnectMap(
		textResult(JSON.stringify({ "1:2": { codeConnectName: "Button" } })),
		"1:2",
	).length === 0,
);

console.log("\n=== the screenshot ===");

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

check("the image block is found", shot?.contentType === "image/png");
check(
	"its bytes are decoded",
	Buffer.from(shot?.bytes ?? []).toString("utf8") === "PNG!",
);
check(
	"an answer with no image has none",
	parseScreenshot(textResult("Nothing is selected")) === undefined,
);
check(
	"an image without a media type is still a picture",
	parseScreenshot({ content: [{ type: "image", data: "UE5H" }] })
		?.contentType === "image/png",
);
console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

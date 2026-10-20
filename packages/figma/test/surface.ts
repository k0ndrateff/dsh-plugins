/**
 * The panel, the tool and the route — against a channel to Figma that answers
 * from a script.
 *
 * What matters here is the contract: which MCP tool each operation calls, with
 * which arguments, what it does with the answer, and that a node the server
 * cannot describe is answered as a failure rather than as an empty panel. The
 * answers themselves are proved in `readers.ts`; this file proves the wiring
 * around them.
 *
 *   bun run test/surface.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { IntegrationAuthFace } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { PanelApi } from "../src/host/panels/panel";
import { createApiHandler, ROUTE_PREFIX } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import type { FigmaStatus } from "../src/shared/status";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** One tool call the fake bridge was asked to make. */
interface Call {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

/** A bridge that answers from a script, and records what it was asked. */
function fakeBridge(answer: (call: Call) => unknown): {
	bridge: McpBridge;
	calls: Call[];
} {
	const calls: Call[] = [];

	const bridge = {
		callTool: async (
			name: string,
			args: Record<string, unknown>,
		): Promise<unknown> => {
			const call = { name, args };
			calls.push(call);

			return answer(call);
		},
	} as unknown as McpBridge;

	return { bridge, calls };
}

/** A host context with just enough surface for the panel's logger. */
const context = {
	logger: { info: () => {}, warn: () => {} },
} as unknown as Context;

/** The metadata of one frame, as the server answers it. */
const FRAME = `<frame id="960:6938" name="Menu Items" x="14096" y="2243" width="260" height="502">
  <symbol id="960:6939" name="State=Default" x="20" y="14" width="75" height="40" />
  <symbol id="960:6941" name="State=Hover" x="20" y="54" width="75" height="40" />
</frame>`;

const VARIABLES = JSON.stringify({
	"text/primary": "#ffffff",
	"8": "8",
});

const CODE_CONNECT = JSON.stringify({
	"960:6938": {
		codeConnectSrc: "src/components/menu-items.tsx",
		codeConnectName: "MenuItems",
	},
});

const PNG = Buffer.from("PNG-BYTES").toString("base64");

/** What the server answers, whatever it is asked. */
function serverAnswer(call: Call): unknown {
	if (call.name === "get_metadata")
		return {
			content: [
				{
					type: "text",
					text:
						call.args.nodeId === undefined
							? FRAME
							: FRAME.replace("960:6938", String(call.args.nodeId)),
				},
			],
		};

	if (call.name === "get_variable_defs")
		return { content: [{ type: "text", text: VARIABLES }] };

	if (call.name === "get_code_connect_map")
		return { content: [{ type: "text", text: CODE_CONNECT }] };

	if (call.name === "get_screenshot")
		return {
			content: [{ type: "image", mimeType: "image/png", data: PNG }],
		};

	return { content: [] };
}

/** One tool execution, as far as the tool reads it. */
function execution(callId: string): ToolRunContext {
	return {
		callId,
		signal: new AbortController().signal,
		agent: {},
	} as unknown as ToolRunContext;
}

/** The text one render call produced. */
function textOf(definition: ToolDefinition, value: unknown): string {
	return definition.output
		.render({}, value as never)
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
}

/** The card one settled result carries, as the browser half reads it. */
function metaOf(
	definition: ToolDefinition,
	value: unknown,
): Record<string, unknown> {
	const meta = definition.output.presentationMeta?.({}, value as never);

	return (meta ?? {}) as Record<string, unknown>;
}

console.log("\n=== the panel's document ===");

{
	const { bridge, calls } = fakeBridge(serverAnswer);
	const panel = new PanelApi({ bridge, ctx: context });
	const document = await panel.node({ node: "960:6938" });

	check(
		"the node is read by the id it was opened on",
		document.node.id === "960:6938",
	);
	check(
		"its facts come from the metadata",
		document.node.type === "frame" && document.node.width === 260,
	);
	check("its children come with it", document.children.length === 2);
	check(
		"its variables come from the variables tool",
		document.tokens.length === 2 &&
			document.tokens.some((token) => token.name === "text/primary"),
	);
	check(
		"its mapping comes from the Code Connect tool",
		document.mappings[0]?.component === "MenuItems",
	);
	check(
		"the picture is a route of this plugin's own",
		document.screenshot?.startsWith(
			`${ROUTE_PREFIX}/screenshot?node=960%3A6938`,
		) === true,
		String(document.screenshot),
	);
	check(
		"every read names the same node",
		calls
			.filter((call) => call.name !== "get_screenshot")
			.every((call) => call.args.nodeId === "960:6938"),
		JSON.stringify(calls.map((call) => [call.name, call.args])),
	);
}

{
	const { bridge, calls } = fakeBridge(serverAnswer);
	const panel = new PanelApi({ bridge, ctx: context });
	const document = await panel.node({});

	check(
		"a target with no node reads the current selection",
		document.node.id === "960:6938" &&
			calls[0]?.name === "get_metadata" &&
			calls[0]?.args.nodeId === undefined,
	);
}

{
	const { bridge } = fakeBridge(() => ({
		content: [{ type: "text", text: "Nothing is selected" }],
		isError: true,
	}));
	const panel = new PanelApi({ bridge, ctx: context });

	let message = "";
	try {
		await panel.node({});
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}

	check(
		"nothing selected is answered as an instruction, not as an empty panel",
		message.includes("Select a frame"),
		message,
	);
}

{
	const { bridge } = fakeBridge((call) =>
		call.name === "get_metadata"
			? { content: [{ type: "text", text: "No such node" }], isError: true }
			: serverAnswer(call),
	);
	const panel = new PanelApi({ bridge, ctx: context });

	let message = "";
	try {
		await panel.node({ node: "1:2" });
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}

	check(
		"a node the server cannot describe fails the panel",
		message.includes("no metadata for node 1:2"),
		message,
	);
}

{
	const { bridge } = fakeBridge((call) => {
		if (
			call.name === "get_variable_defs" ||
			call.name === "get_code_connect_map"
		)
			throw new Error("transport is closed");

		return serverAnswer(call);
	});
	const panel = new PanelApi({ bridge, ctx: context });
	const document = await panel.node({ node: "960:6938" });

	check(
		"a node with no variables and no mapping still opens",
		document.tokens.length === 0 && document.mappings.length === 0,
	);
}

console.log("\n=== the picture ===");

{
	const { bridge } = fakeBridge(serverAnswer);
	const panel = new PanelApi({ bridge, ctx: context });
	const shot = await panel.screenshot("960:6938");

	check(
		"the picture is the bytes the server sent",
		Buffer.from(shot.bytes).toString("utf8") === "PNG-BYTES",
	);
	check("its media type comes with it", shot.contentType === "image/png");
}

{
	const { bridge } = fakeBridge(() => ({
		content: [{ type: "text", text: "no" }],
	}));
	const panel = new PanelApi({ bridge, ctx: context });

	let message = "";
	try {
		await panel.screenshot("1:2");
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}

	check(
		"a node with no picture is a failure",
		message.includes("no picture"),
		message,
	);
}

console.log("\n=== the tool ===");

{
	const { bridge } = fakeBridge(serverAnswer);
	const panel = new PanelApi({ bridge, ctx: context });
	const definition = presentTool.create({
		panel,
		imageTool: "mcp__figma__get_screenshot",
	});
	const value = await definition.execute(
		{ node: "960:6938" },
		execution("call-7"),
	);
	const summary = textOf(definition, value);

	check(
		"the tool names the node it showed",
		summary.includes('"Menu Items" (960:6938)'),
	);
	check("it reports the size", summary.includes("260×502"));
	check("it lists the variables", summary.includes("text/primary = #ffffff"));
	check(
		"it names the component",
		summary.includes("MenuItems (src/components/menu-items.tsx)"),
	);
	check(
		"it tells the model how to look at the design itself",
		summary.includes("mcp__figma__get_screenshot"),
	);
	check(
		"the picture never reaches the model",
		(definition.output.render({}, value as never) as { type: string }[]).every(
			(block) => block.type === "text",
		),
	);

	const meta = metaOf(definition, value);

	check("the card is keyed by the call", meta.callId === "call-7");
	check(
		"the card carries the node's facts",
		(meta.node as { tokenCount?: number })?.tokenCount === 2 &&
			(meta.node as { childCount?: number })?.childCount === 2,
	);
	check(
		"the card carries the mapping when there is one",
		(meta.node as { component?: string })?.component === "MenuItems",
	);
	check("one node is a single-row card", meta.layout === "single");
}

{
	const { bridge } = fakeBridge(serverAnswer);
	const panel = new PanelApi({ bridge, ctx: context });
	const definition = presentTool.create({
		panel,
		imageTool: "mcp__figma__get_screenshot",
	});
	const value = await definition.execute({}, execution("call-8"));

	check(
		"a call with no node shows the selection",
		(value as { nodeId: string }).nodeId === "960:6938",
	);
}

console.log("\n=== the route ===");

{
	const status: FigmaStatus = {
		signedIn: true,
		inFlight: false,
		expiresAt: null,
		scope: null,
		notice: null,
		error: null,
		connected: true,
		tools: ["mcp__figma__get_metadata"],
		endpoint: "http://127.0.0.1:3845/mcp",
	};

	const { bridge, calls } = fakeBridge(serverAnswer);
	const auth: IntegrationAuthFace<FigmaStatus> = {
		getStatus: async () => status,
		signIn: async () => ({ status: "unavailable" }),
		signOut: async () => {},
		connect: async () => true,
		loginMessage: () => "Nothing to sign in to.",
		settleNotice: async () => {},
	};

	const handler = createApiHandler({
		auth,
		panel: new PanelApi({ bridge, ctx: context }),
	});

	/** One request/response pair, without a socket under it. */
	const call = async (
		method: string,
		path: string,
	): Promise<{
		status: number;
		type: string;
		body: unknown;
		bytes: string;
	}> => {
		const request = {
			method,
			url: path,
			async *[Symbol.asyncIterator]() {
				yield Buffer.from("");
			},
		} as unknown as IncomingMessage;

		let code = 0;
		let type = "";
		let payload: Buffer | undefined;

		const response = {
			writeHead: (value: number, headers: Record<string, string>) => {
				code = value;
				type = headers["content-type"] ?? "";

				return response;
			},
			end: (value?: Buffer | string) => {
				payload = Buffer.isBuffer(value) ? value : Buffer.from(value ?? "");
			},
		} as unknown as ServerResponse;

		await handler(request, response);

		return {
			status: code,
			type,
			bytes: payload?.toString("utf8") ?? "",
			body:
				type.startsWith("application/json") && payload !== undefined
					? JSON.parse(payload.toString("utf8"))
					: undefined,
		};
	};

	const read = await call("GET", `${ROUTE_PREFIX}/status`);

	check(
		"the settings card reads the status",
		read.status === 200 &&
			(read.body as { connected?: boolean }).connected === true,
	);

	const document = await call("GET", `${ROUTE_PREFIX}/node?node=960%3A6938`);

	check(
		"the panel reads one node",
		document.status === 200 &&
			(document.body as { node?: { id?: string } }).node?.id === "960:6938",
		JSON.stringify(document.body).slice(0, 80),
	);

	const selection = await call("GET", `${ROUTE_PREFIX}/node`);

	check(
		"a panel opened with no node reads the selection",
		selection.status === 200 &&
			calls.some((entry) => entry.args.nodeId === undefined),
	);

	const section = await call(
		"GET",
		`${ROUTE_PREFIX}/node?node=1%3A2&section=tokens`,
	);

	check(
		"a named section is carried into the target",
		section.status === 200,
		`${section.status}: ${JSON.stringify(section.body).slice(0, 80)}`,
	);

	const badSection = await call("GET", `${ROUTE_PREFIX}/node?section=layers`);

	check(
		"a section that is not one of the three is a bad request",
		badSection.status === 400,
		String(badSection.status),
	);

	const badNode = await call("GET", `${ROUTE_PREFIX}/node?node=Menu%20Items`);

	check(
		"a node the server could not read is a bad request, not a bad gateway",
		badNode.status === 400,
		String(badNode.status),
	);

	const picture = await call(
		"GET",
		`${ROUTE_PREFIX}/screenshot?node=960%3A6938`,
	);

	check(
		"the picture is answered as bytes",
		picture.status === 200 &&
			picture.type === "image/png" &&
			picture.bytes === "PNG-BYTES",
		`${picture.status} ${picture.type} ${picture.bytes.slice(0, 120)}`,
	);

	const noNode = await call("GET", `${ROUTE_PREFIX}/screenshot`);

	check(
		"a picture request with no node is a bad request",
		noNode.status === 400,
		String(noNode.status),
	);

	const refused = createApiHandler({
		auth,
		panel: new PanelApi({
			bridge: fakeBridge(() => ({ content: [] })).bridge,
			ctx: context,
		}),
	});

	let code = 0;
	let type = "";
	let payload = "";
	const response = {
		writeHead: (value: number, headers: Record<string, string>) => {
			code = value;
			type = headers["content-type"] ?? "";

			return response;
		},
		end: (value?: Buffer | string) => {
			payload = value?.toString() ?? "";
		},
	} as unknown as ServerResponse;

	await refused(
		{
			method: "GET",
			url: `${ROUTE_PREFIX}/screenshot?node=1%3A2`,
			async *[Symbol.asyncIterator]() {
				yield Buffer.from("");
			},
		} as unknown as IncomingMessage,
		response,
	);

	check(
		"a picture the server cannot give is a bad gateway, with its reason",
		code === 502 &&
			type.startsWith("application/json") &&
			payload.includes("no picture"),
		`${code} ${payload.slice(0, 60)}`,
	);

	const unknown = await call("GET", `${ROUTE_PREFIX}/nothing`);

	check(
		"an unknown path is not found",
		unknown.status === 404,
		String(unknown.status),
	);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

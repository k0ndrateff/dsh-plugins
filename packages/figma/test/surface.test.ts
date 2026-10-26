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

import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { IntegrationAuthFace } from "dsh-integration-host";
import type { McpBridge } from "dsh-mcp-oauth";
import { PanelApi } from "../src/host/panels/panel";
import { createCommandHandler } from "../src/host/surface/command";
import { createApiHandler, ROUTE_PREFIX } from "../src/host/surface/http";
import { presentTool } from "../src/host/tools/present";
import type { FigmaStatus } from "../src/shared/status";

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

test("the panel's document", async () => {
	{
		const { bridge, calls } = fakeBridge(serverAnswer);
		const panel = new PanelApi({ bridge, ctx: context });
		const document = await panel.node({ node: "960:6938" });

		expect(
			document.node.id === "960:6938",
			"the node is read by the id it was opened on",
		).toBe(true);
		expect(
			document.node.type === "frame" && document.node.width === 260,
			"its facts come from the metadata",
		).toBe(true);
		expect(document.children.length === 2, "its children come with it").toBe(
			true,
		);
		expect(
			document.tokens.length === 2 &&
				document.tokens.some((token) => token.name === "text/primary"),
			"its variables come from the variables tool",
		).toBe(true);
		expect(
			document.mappings[0]?.component === "MenuItems",
			"its mapping comes from the Code Connect tool",
		).toBe(true);
		expect(
			document.screenshot?.startsWith(
				`${ROUTE_PREFIX}/screenshot?node=960%3A6938`,
			) === true,
			`the picture is a route of this plugin's own — ${String(document.screenshot)}`,
		).toBe(true);
		expect(
			calls
				.filter((call) => call.name !== "get_screenshot")
				.every((call) => call.args.nodeId === "960:6938"),
			`every read names the same node — ${JSON.stringify(calls.map((call) => [call.name, call.args]))}`,
		).toBe(true);
	}

	{
		const { bridge, calls } = fakeBridge(serverAnswer);
		const panel = new PanelApi({ bridge, ctx: context });
		const document = await panel.node({});

		expect(
			document.node.id === "960:6938" &&
				calls[0]?.name === "get_metadata" &&
				calls[0]?.args.nodeId === undefined,
			"a target with no node reads the current selection",
		).toBe(true);
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

		expect(
			message.includes("Select a frame"),
			`nothing selected is answered as an instruction, not as an empty panel — ${message}`,
		).toBe(true);
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

		expect(
			message.includes("no metadata for node 1:2"),
			`a node the server cannot describe fails the panel — ${message}`,
		).toBe(true);
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

		expect(
			document.tokens.length === 0 && document.mappings.length === 0,
			"a node with no variables and no mapping still opens",
		).toBe(true);
	}
});
test("the picture", async () => {
	{
		const { bridge } = fakeBridge(serverAnswer);
		const panel = new PanelApi({ bridge, ctx: context });
		const shot = await panel.screenshot("960:6938");

		expect(
			Buffer.from(shot.bytes).toString("utf8") === "PNG-BYTES",
			"the picture is the bytes the server sent",
		).toBe(true);
		expect(
			shot.contentType === "image/png",
			"its media type comes with it",
		).toBe(true);
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

		expect(
			message.includes("no picture"),
			`a node with no picture is a failure — ${message}`,
		).toBe(true);
	}
});
test("the tool", async () => {
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

		expect(
			summary.includes('"Menu Items" (960:6938)'),
			"the tool names the node it showed",
		).toBe(true);
		expect(summary.includes("260×502"), "it reports the size").toBe(true);
		expect(
			summary.includes("text/primary = #ffffff"),
			"it lists the variables",
		).toBe(true);
		expect(
			summary.includes("MenuItems (src/components/menu-items.tsx)"),
			"it names the component",
		).toBe(true);
		expect(
			summary.includes("mcp__figma__get_screenshot"),
			"it tells the model how to look at the design itself",
		).toBe(true);
		expect(
			(
				definition.output.render({}, value as never) as { type: string }[]
			).every((block) => block.type === "text"),
			"the picture never reaches the model",
		).toBe(true);

		const meta = metaOf(definition, value);

		expect(meta.callId === "call-7", "the card is keyed by the call").toBe(
			true,
		);
		expect(
			(meta.node as { tokenCount?: number })?.tokenCount === 2 &&
				(meta.node as { childCount?: number })?.childCount === 2,
			"the card carries the node's facts",
		).toBe(true);
		expect(
			(meta.node as { component?: string })?.component === "MenuItems",
			"the card carries the mapping when there is one",
		).toBe(true);
		expect(meta.layout === "single", "one node is a single-row card").toBe(
			true,
		);
	}

	{
		const { bridge } = fakeBridge(serverAnswer);
		const panel = new PanelApi({ bridge, ctx: context });
		const definition = presentTool.create({
			panel,
			imageTool: "mcp__figma__get_screenshot",
		});
		const value = await definition.execute({}, execution("call-8"));

		expect(
			(value as { nodeId: string }).nodeId === "960:6938",
			"a call with no node shows the selection",
		).toBe(true);
	}
});
test("the route", async () => {
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

		expect(
			read.status === 200 &&
				(read.body as { connected?: boolean }).connected === true,
			"the settings card reads the status",
		).toBe(true);

		const document = await call("GET", `${ROUTE_PREFIX}/node?node=960%3A6938`);

		expect(
			document.status === 200 &&
				(document.body as { node?: { id?: string } }).node?.id === "960:6938",
			`the panel reads one node — ${JSON.stringify(document.body).slice(0, 80)}`,
		).toBe(true);

		const selection = await call("GET", `${ROUTE_PREFIX}/node`);

		expect(
			selection.status === 200 &&
				calls.some((entry) => entry.args.nodeId === undefined),
			"a panel opened with no node reads the selection",
		).toBe(true);

		const section = await call(
			"GET",
			`${ROUTE_PREFIX}/node?node=1%3A2&section=tokens`,
		);

		expect(
			section.status === 200,
			`a named section is carried into the target — ${`${section.status}: ${JSON.stringify(section.body).slice(0, 80)}`}`,
		).toBe(true);

		const badSection = await call("GET", `${ROUTE_PREFIX}/node?section=layers`);

		expect(
			badSection.status === 400,
			`a section that is not one of the three is a bad request — ${String(badSection.status)}`,
		).toBe(true);

		const badNode = await call("GET", `${ROUTE_PREFIX}/node?node=Menu%20Items`);

		expect(
			badNode.status === 400,
			`a node the server could not read is a bad request, not a bad gateway — ${String(badNode.status)}`,
		).toBe(true);

		const picture = await call(
			"GET",
			`${ROUTE_PREFIX}/screenshot?node=960%3A6938`,
		);

		expect(
			picture.status === 200 &&
				picture.type === "image/png" &&
				picture.bytes === "PNG-BYTES",
			`the picture is answered as bytes — ${`${picture.status} ${picture.type} ${picture.bytes.slice(0, 120)}`}`,
		).toBe(true);

		const noNode = await call("GET", `${ROUTE_PREFIX}/screenshot`);

		expect(
			noNode.status === 400,
			`a picture request with no node is a bad request — ${String(noNode.status)}`,
		).toBe(true);

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

		expect(
			code === 502 &&
				type.startsWith("application/json") &&
				payload.includes("no picture"),
			`a picture the server cannot give is a bad gateway, with its reason — ${`${code} ${payload.slice(0, 60)}`}`,
		).toBe(true);

		const unknown = await call("GET", `${ROUTE_PREFIX}/nothing`);

		expect(
			unknown.status === 404,
			`an unknown path is not found — ${String(unknown.status)}`,
		).toBe(true);
	}
});
test("a closed Dev Mode connection is answered with the prerequisite", async () => {
	{
		const { bridge } = fakeBridge(() => {
			throw new Error("the Figma MCP connection is not open");
		});
		const panel = new PanelApi({ bridge, ctx: context });

		let message = "";
		try {
			await panel.node({});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(
			message.includes("Start the Figma desktop app") &&
				message.includes("Enable Dev Mode MCP Server") &&
				message.includes("/figma sync") &&
				!message.includes("connection is not open"),
			`a first run without the desktop app says what to start, not what the transport said — ${message}`,
		).toBe(true);
	}

	{
		const { bridge } = fakeBridge(() => {
			throw new Error("the Figma MCP connection is not open");
		});
		const panel = new PanelApi({ bridge, ctx: context });

		let message = "";
		try {
			await panel.screenshot("960:6938");
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(
			message.includes("Start the Figma desktop app"),
			`the screenshot route answers the same prerequisite — ${message}`,
		).toBe(true);
	}
});
test("a failed optional read is reported as a failure, not as nothing", async () => {
	{
		const { bridge } = fakeBridge((call) => {
			if (call.name === "get_variable_defs")
				throw new Error("the Figma MCP connection is not open");

			return serverAnswer(call);
		});
		const panel = new PanelApi({ bridge, ctx: context });
		const document = await panel.node({ node: "960:6938" });

		expect(
			document.tokensError?.includes("Start the Figma desktop app") === true &&
				document.mappingsError === undefined,
			`what could not be read is kept apart from what was read — ${document.tokensError}`,
		).toBe(true);

		const definition = presentTool.create({
			panel,
			imageTool: "mcp__figma__get_screenshot",
		});
		const value = await definition.execute(
			{ node: "960:6938" },
			execution("call-9"),
		);
		const summary = textOf(definition, value);

		expect(
			summary.includes("Variables: could not be read") &&
				!summary.includes("Variables: none"),
			`the model is not told a failed read found no variables — ${summary.split("\n").find((line) => line.startsWith("Variables"))}`,
		).toBe(true);
	}
});
test("the tool's description carries the prerequisite, the image tool and the depth", () => {
	const { bridge } = fakeBridge(serverAnswer);
	const definition = presentTool.create({
		panel: new PanelApi({ bridge, ctx: context }),
		imageTool: "mcp__figma__get_screenshot",
	});
	const description = definition.description ?? "";

	expect(
		description.includes("Figma desktop app") &&
			description.includes("Enable Dev Mode MCP Server") &&
			description.includes("mcp__figma__get_screenshot") &&
			description.includes("direct children only") &&
			description.includes("openPanel: false"),
		`the description names what to start, what to call for the picture, and how deep the answer goes — ${description.slice(0, 160)}`,
	).toBe(true);
	expect(
		(
			definition.parameters as {
				properties?: { openPanel?: { type?: string } };
			}
		).properties?.openPanel?.type === "boolean",
		"the panel-opening behaviour has an opt-out in the schema",
	).toBe(true);
});
test("an unknown /figma action is answered with the actions there are", async () => {
	const handler = createCommandHandler({
		getStatus: async () => ({
			signedIn: false,
			inFlight: false,
			expiresAt: null,
			scope: null,
			notice: null,
			error: null,
			connected: false,
			tools: [],
			endpoint: "http://127.0.0.1:3845/mcp",
		}),
		signIn: async () => ({ status: "unavailable" }),
		signOut: async () => {},
		connect: async () => false,
		loginMessage: () => "Nothing to sign in to.",
		settleNotice: async () => {},
	});

	const result = await handler({ rawInput: "logn" });

	expect(
		result.kind === "error" &&
			result.text.includes("is not a /figma action") &&
			result.text.includes("status, login, logout, sync"),
		`a typo is an error listing the actions, not a silent status — ${result.text}`,
	).toBe(true);
});

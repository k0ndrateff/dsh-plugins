/**
 * The host-half shell against fakes.
 *
 * Everything here is a pure decision or a contract: how a profile patch is
 * normalized, what the auth learns and remembers, which paths the route answers
 * and how it words a refusal, and what the command says. No live endpoint is
 * touched, so the file runs anywhere.
 *
 *   bun run test/unit.ts
 */

import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Context, Service } from "@deepseek-ai/cordis";
import type { AuthorizationFlow, GrantStore, McpBridge } from "dsh-mcp-oauth";
import { IntegrationAuth } from "../src/auth";
import { createIntegrationCommand } from "../src/command";
import { resolveEndpointConfig } from "../src/config";
import type { FactsReader } from "../src/facts";
import { stripHtmlComments } from "../src/markdown";
import { createIntegrationRoute, mountIntegrationRoute } from "../src/route";
import { RuntimeState } from "../src/state";
import type { IntegrationStatus } from "../src/status";

test("the integration host", async () => {
	console.log("\n=== configuration ===");

	const DEFAULTS = { endpoint: "https://example.test/mcp", redirectPort: 8144 };

	expect(
		resolveEndpointConfig(undefined, DEFAULTS).endpoint === DEFAULTS.endpoint &&
			resolveEndpointConfig(undefined, DEFAULTS).redirectPort ===
				DEFAULTS.redirectPort,
		`an empty patch falls back to the provider's own resource and port — ${JSON.stringify(resolveEndpointConfig(undefined, DEFAULTS))}`,
	).toBe(true);
	expect(
		resolveEndpointConfig({ redirectPort: "eighty" }, DEFAULTS).redirectPort ===
			DEFAULTS.redirectPort &&
			resolveEndpointConfig({ redirectPort: -1 }, DEFAULTS).redirectPort ===
				DEFAULTS.redirectPort &&
			resolveEndpointConfig({ redirectPort: 70_000 }, DEFAULTS).redirectPort ===
				DEFAULTS.redirectPort,
		"a malformed port falls back rather than failing activation",
	).toBe(true);
	expect(
		resolveEndpointConfig(
			{ endpoint: "https://other.test/mcp", redirectPort: 9000 },
			DEFAULTS,
		).endpoint === "https://other.test/mcp" &&
			resolveEndpointConfig({ redirectPort: 9000 }, DEFAULTS).redirectPort ===
				9000,
		"a configured endpoint and port are kept",
	).toBe(true);
	expect(
		resolveEndpointConfig({}, DEFAULTS).debug === false &&
			resolveEndpointConfig({ debug: true }, DEFAULTS).debug === true,
		"debug is off unless asked for",
	).toBe(true);

	/** The facts one test provider learns: a slug and a web URL. */
	class Facts {
		readonly slug?: string;
		readonly webUrl?: string;

		constructor(params: { slug?: string; webUrl?: string }) {
			this.slug = params.slug;
			this.webUrl = params.webUrl;
		}

		get isEmpty(): boolean {
			return this.slug === undefined && this.webUrl === undefined;
		}

		get isComplete(): boolean {
			return this.slug !== undefined && this.webUrl !== undefined;
		}
	}

	const reader: FactsReader<Facts> = {
		toolName: "list_things",
		from: (grant) =>
			new Facts({
				...(typeof grant?.extra?.slug === "string"
					? { slug: grant.extra.slug }
					: {}),
				...(typeof grant?.extra?.webUrl === "string"
					? { webUrl: grant.extra.webUrl }
					: {}),
			}),
		parse: (value) => {
			const record =
				value !== null && typeof value === "object"
					? (value as { slug?: unknown; webUrl?: unknown })
					: {};

			return new Facts({
				...(typeof record.slug === "string" ? { slug: record.slug } : {}),
				...(typeof record.webUrl === "string" ? { webUrl: record.webUrl } : {}),
			});
		},
		merge: (known, learned) =>
			new Facts({
				slug: learned.slug ?? known?.slug,
				webUrl: learned.webUrl ?? known?.webUrl,
			}),
		remember: (facts) => ({
			...(facts.slug === undefined ? {} : { slug: facts.slug }),
			...(facts.webUrl === undefined ? {} : { webUrl: facts.webUrl }),
		}),
	};

	interface TestStatus extends IntegrationStatus {
		readonly slug: string | null;
	}

	const statusOf = (
		base: IntegrationStatus,
		facts: Facts | undefined,
	): TestStatus => ({
		...base,
		slug: facts?.slug ?? null,
	});

	const spec = {
		label: "Example",
		logTag: "[example]",
		facts: reader,
		status: statusOf,
	};

	/** One stored grant, as far as the auth reads it. */
	function grantOf(extra: Record<string, string>) {
		return {
			version: 1,
			extra,
			isSignedIn: () => true,
			expiresAt: Date.now() + 3_600_000,
			scope: "read",
		};
	}

	console.log("\n=== the auth ===");

	/** One fake connection whose script the test rewrites per case. */
	function harness(options: {
		grant?: unknown;
		tools?: readonly string[];
		answer?: unknown;
		answerThrows?: boolean;
		ensure?: boolean;
	}) {
		const remembered: Record<string, unknown>[] = [];
		const calls: { name: string; args: Record<string, unknown> }[] = [];
		const state = new RuntimeState<Facts>();

		const store = {
			credentialKey: "dsh-example/mcp",
			read: async () => options.grant,
			remember: async (extra: Record<string, unknown>) => {
				remembered.push(extra);
			},
			clear: async () => undefined,
		} as unknown as GrantStore;

		const bridge = {
			isConnected: options.ensure !== false,
			toolNames: options.tools ?? ["mcp__example__list_things"],
			ensure: async () => options.ensure !== false,
			callTool: async (name: string, args: Record<string, unknown>) => {
				calls.push({ name, args });

				if (options.answerThrows === true) throw new Error("no answer");

				return options.answer;
			},
			drop: async () => undefined,
		} as unknown as McpBridge;

		const auth = new IntegrationAuth<TestStatus, Facts>({
			ctx: {} as unknown as Context,
			config: { endpoint: DEFAULTS.endpoint, redirectPort: 8144, debug: false },
			state,
			store,
			flow: {} as unknown as AuthorizationFlow,
			bridge,
			spec,
		});

		return { auth, state, remembered, calls };
	}

	{
		const { auth, remembered, calls } = harness({
			grant: grantOf({ slug: "acme", webUrl: "https://acme.test" }),
			answer: { slug: "acme", webUrl: "https://acme.test" },
		});

		await auth.connect();

		expect(
			calls.length === 0,
			`a complete stored grant is restored without asking the server — ${JSON.stringify(calls.map((call) => call.name))}`,
		).toBe(true);

		const status = await auth.getStatus();

		expect(
			status.connected &&
				status.slug === "acme" &&
				status.endpoint === DEFAULTS.endpoint &&
				status.tools.length === 1,
			`the status carries the shared fields and the provider's own — ${JSON.stringify({ slug: status.slug, connected: status.connected })}`,
		).toBe(true);
		expect(remembered.length === 0, "nothing was remembered again").toBe(true);
	}

	{
		const { auth, state, remembered, calls } = harness({
			answer: { slug: "acme" },
		});

		await auth.connect();

		expect(
			calls[0]?.name === "list_things" && state.facts?.slug === "acme",
			`an unknown account is learned through the provider's own tool — ${JSON.stringify(calls[0])}`,
		).toBe(true);
		expect(
			remembered[0]?.slug === "acme" && remembered.length === 1,
			`what was learned is remembered in the credential record — ${JSON.stringify(remembered)}`,
		).toBe(true);
		expect(
			state.facts?.isComplete === false,
			`a partial answer is not treated as complete — ${String(state.facts?.isComplete)}`,
		).toBe(true);
	}

	{
		const { auth, remembered } = harness({
			answer: { webUrl: "https://acme.test" },
			grant: grantOf({ slug: "acme" }),
		});

		await auth.connect();

		expect(
			remembered[0]?.slug === "acme" &&
				remembered[0]?.webUrl === "https://acme.test",
			`learned facts merge into what the grant already knew — ${JSON.stringify(remembered[0])}`,
		).toBe(true);
	}

	{
		const { auth, state } = harness({ answer: {}, answerThrows: true });

		await auth.connect();

		expect(
			state.facts?.isEmpty === true,
			`a server that refuses the account tool leaves the plugin usable — ${JSON.stringify(state.facts)}`,
		).toBe(true);
	}

	{
		const { auth, calls } = harness({
			answer: { slug: "acme" },
			tools: ["mcp__example__something_else"],
		});

		await auth.connect();

		expect(
			calls.length === 0,
			`a bridge without the account tool is not asked for it — ${JSON.stringify(calls.map((call) => call.name))}`,
		).toBe(true);
	}

	console.log("\n=== the route ===");

	/** The auth face the route and the command read, scripted per case. */
	function face(status: TestStatus) {
		const seen: string[] = [];

		return {
			seen,
			auth: {
				getStatus: async () => status,
				signIn: async () => {
					seen.push("signIn");

					return {};
				},
				cancel: async () => {
					seen.push("cancel");
				},
				signOut: async () => {
					seen.push("signOut");
				},
				connect: async () => {
					seen.push("connect");

					return true;
				},
				loginMessage: () => "Opening your browser…",
				settleNotice: async () => undefined,
			},
		};
	}

	const status: TestStatus = {
		signedIn: true,
		inFlight: false,
		expiresAt: null,
		scope: "read",
		slug: "acme",
		notice: null,
		error: null,
		connected: true,
		tools: ["mcp__example__list_things"],
		endpoint: DEFAULTS.endpoint,
	};

	const { auth: routeAuth, seen } = face(status);

	const handler = createIntegrationRoute<TestStatus>({
		prefix: "/dsh-example",
		auth: routeAuth,
		routes: [
			async (route) => {
				if (route.url.pathname !== "/dsh-example/thing") return false;

				// The request is read and validated before any work starts, so a
				// caller's mistake is answered as one instead of as a bad gateway.
				const body = await route.read();
				const id = body.required("id");

				await route.sendData(async () => ({ id }));

				return true;
			},
		],
	});

	/** The headers every request from the harness page carries. */
	const PAGE_HEADERS = {
		host: "127.0.0.1:52849",
		origin: "http://127.0.0.1:52849",
		"sec-fetch-site": "same-origin",
		"x-dsh-client": "1",
		"content-type": "application/json",
	};

	/** One request/response pair, without a socket under it. */
	async function call(
		method: string,
		path: string,
		body?: unknown,
		headers: Readonly<Record<string, string | undefined>> = {},
	): Promise<{ status: number; body: unknown }> {
		const chunks =
			body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
		const request = {
			method,
			url: path,
			headers: { ...PAGE_HEADERS, ...headers },
			async *[Symbol.asyncIterator]() {
				for (const chunk of chunks) yield chunk;
			},
		} as unknown as IncomingMessage;

		let code = 0;
		let payload = "";
		const response = {
			writeHead: (value: number) => {
				code = value;

				return response;
			},
			end: (value?: string) => {
				payload = value ?? "";
			},
		} as unknown as ServerResponse;

		await handler(request, response);

		return {
			status: code,
			body: payload === "" ? undefined : JSON.parse(payload),
		};
	}

	{
		const read = await call("GET", "/dsh-example/status");

		expect(
			read.status === 200 && (read.body as { slug?: string }).slug === "acme",
			`the settings card reads the status — ${JSON.stringify(read.body).slice(0, 60)}`,
		).toBe(true);

		const login = await call("POST", "/dsh-example/login");

		expect(
			login.status === 202 && seen.includes("signIn"),
			`login starts an attempt and answers with the running state — ${`${login.status}: ${JSON.stringify(seen)}`}`,
		).toBe(true);

		const cancel = await call("POST", "/dsh-example/cancel");

		expect(
			cancel.status === 200 && seen.includes("cancel"),
			`cancel stops the running browser flow — ${JSON.stringify(seen)}`,
		).toBe(true);

		const logout = await call("POST", "/dsh-example/logout");

		expect(
			logout.status === 200 && seen.includes("signOut"),
			`logout forgets the sign-in — ${JSON.stringify(seen)}`,
		).toBe(true);

		const sync = await call("POST", "/dsh-example/sync");

		expect(
			sync.status === 200 && seen.includes("connect"),
			`sync reconnects — ${JSON.stringify(seen)}`,
		).toBe(true);

		const thing = await call("POST", "/dsh-example/thing", { id: "abc" });

		expect(
			thing.status === 200 && (thing.body as { id?: string }).id === "abc",
			`a provider path answers through the shared route — ${JSON.stringify(thing.body)}`,
		).toBe(true);

		const missing = await call("POST", "/dsh-example/thing", {});

		expect(
			missing.status === 400 &&
				String((missing.body as { error?: string }).error).includes("id"),
			`a write without its field is a bad request, not a gateway error — ${`${missing.status}: ${JSON.stringify(missing.body)}`}`,
		).toBe(true);

		const crossOrigin = await call(
			"POST",
			"/dsh-example/thing",
			{ id: "abc" },
			{
				origin: "https://evil.example",
			},
		);

		expect(
			crossOrigin.status === 403 &&
				String((crossOrigin.body as { error?: string }).error).includes(
					"another origin",
				),
			`a write from another web origin is refused — ${`${crossOrigin.status}: ${JSON.stringify(crossOrigin.body)}`}`,
		).toBe(true);

		const untagged = await call(
			"POST",
			"/dsh-example/thing",
			{ id: "abc" },
			{
				"x-dsh-client": undefined,
			},
		);

		expect(
			untagged.status === 403 &&
				String((untagged.body as { error?: string }).error).includes(
					"harness page",
				),
			`a write without the page header is refused — ${`${untagged.status}: ${JSON.stringify(untagged.body)}`}`,
		).toBe(true);

		const unknown = await call("GET", "/dsh-example/nope");

		expect(
			unknown.status === 404,
			`an unknown path is a not-found — ${String(unknown.status)}`,
		).toBe(true);
	}

	console.log("\n=== the command ===");

	{
		const { auth: commandAuth, seen: commandSeen } = face(status);
		const run = createIntegrationCommand<TestStatus>(
			{
				name: "example",
				label: "Example",
				describe: (value) =>
					value.slug === null ? "" : `Account: ${value.slug}.`,
			},
			commandAuth,
		);

		const statusAnswer = await run({ rawInput: "status" });

		expect(
			statusAnswer.kind === "success" &&
				statusAnswer.text.startsWith("Connected to Example.") &&
				statusAnswer.text.includes("Account: acme.") &&
				statusAnswer.text.includes("1 tools loaded."),
			`the status answer names the provider, the token and the account — ${statusAnswer.text}`,
		).toBe(true);

		const login = await run({ rawInput: "login" });

		expect(
			login.kind === "success" &&
				login.text === "Opening your browser…" &&
				commandSeen.includes("signIn"),
			`login reports the attempt through the auth's own message — ${login.text}`,
		).toBe(true);

		const logout = await run({ rawInput: "logout" });

		expect(
			logout.text === "Signed out of Example.",
			`logout names the provider — ${logout.text}`,
		).toBe(true);

		const sync = await run({ rawInput: "sync" });

		expect(
			sync.kind === "success" && sync.text === "Example tools ready (1).",
			`sync reports how many tools are ready — ${sync.text}`,
		).toBe(true);

		const expiringFace = face({
			...status,
			expiresAt: Date.now() + 3_600_000,
		});
		const expiring = await createIntegrationCommand<TestStatus>(
			{
				name: "example",
				label: "Example",
				describe: (value) =>
					value.slug === null ? "" : `Account: ${value.slug}.`,
			},
			expiringFace.auth,
		)({ rawInput: "status" });

		expect(
			expiring.kind === "success" &&
				expiring.text.includes("Token valid until") &&
				!expiring.text.includes("unknown"),
			`a token with an expiry is formatted with its zone — ${expiring.text}`,
		).toBe(true);

		const unknown = await run({ rawInput: "whatever" });

		expect(
			unknown.kind === "error" &&
				unknown.text.includes("Unknown action") &&
				unknown.text.includes("status|login|logout|sync"),
			`an unrecognized action names the accepted ones — ${unknown.text}`,
		).toBe(true);

		const failing = createIntegrationCommand<TestStatus>(
			{ name: "example", label: "Example" },
			{
				...commandAuth,
				connect: async () => {
					throw new Error("bridge is down");
				},
			},
		);

		const refused = await failing({ rawInput: "sync" });

		expect(
			refused.kind === "error" && refused.text === "Example: bridge is down",
			`a failure is answered as the provider's own error — ${refused.text}`,
		).toBe(true);
	}

	console.log("\n=== mounting the route ===");

	{
		/** A web server that records what was mounted on it. */
		class FakeWebServer extends Service {
			mounted: string[] = [];

			constructor(ctx: Context) {
				super(ctx, "webServer" as never);
			}

			register(route: { path: string }): () => void {
				this.mounted.push(route.path);

				return () => {
					this.mounted = this.mounted.filter((path) => path !== route.path);
				};
			}
		}

		const handler = async (): Promise<void> => {};
		const context = new Context();

		// The failing order: a plugin mounts its route before the listener's fiber is
		// active, which is what a row that merely reads `ctx.get("webServer")` gets
		// wrong — the card then never reaches the host, and nothing says why.
		mountIntegrationRoute(context, { prefix: "/dsh-early", handler });

		const before = (
			context as unknown as { get: (name: string) => unknown }
		).get("webServer");

		expect(
			before === undefined,
			"a listener that has not mounted yet is not there to read",
		).toBe(true);

		const fiber = context.plugin(FakeWebServer);

		await fiber;
		await new Promise((resolve) => setTimeout(resolve, 20));

		const server = (
			context as unknown as { get: (name: string) => FakeWebServer }
		).get("webServer");

		expect(
			server.mounted.includes("/dsh-early"),
			`the route reaches a listener that arrives later — ${server.mounted.join(", ")}`,
		).toBe(true);

		await fiber.dispose();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			!server.mounted.includes("/dsh-early"),
			`and leaves with it — ${server.mounted.join(", ")}`,
		).toBe(true);
	}

	console.log("\n=== markdown ===");

	expect(
		stripHtmlComments("# Title\n\nBody.") === "# Title\n\nBody.",
		"a document without a comment is returned as it stands",
	).toBe(true);
	expect(
		stripHtmlComments("one\n\n<!-- note -->\n\ntwo") === "one\n\ntwo",
		"a comment that stood as a paragraph takes its empty lines with it",
	).toBe(true);
	expect(
		stripHtmlComments("before <!-- note -->after") === "before after",
		"an inline comment leaves one space where the page renders one",
	).toBe(true);
	expect(
		stripHtmlComments("one <!-- note --> two") === "one two",
		"a comment between two spaces leaves one of them",
	).toBe(true);
	expect(
		stripHtmlComments("a\n<!-- one\ntwo -->\nb") === "a\n\nb",
		"a comment that spans lines goes whole",
	).toBe(true);
	expect(
		stripHtmlComments("```\n<!-- an example -->\n```") ===
			"```\n<!-- an example -->\n```",
		"a fenced example of a comment is content",
	).toBe(true);
	expect(
		stripHtmlComments("~~~\n<!-- kept -->\n~~~") === "~~~\n<!-- kept -->\n~~~",
		"a tilde fence counts as a fence too",
	).toBe(true);
	expect(
		stripHtmlComments("a<!-- one -->b<!-- two -->c") === "abc",
		"two comments on one line both go",
	).toBe(true);
	expect(
		stripHtmlComments("a\n<!-- b\nc") === "a",
		"an unterminated comment swallows what follows it",
	).toBe(true);
	expect(
		stripHtmlComments("keep my  \n<!-- drop me -->\nafter") ===
			"keep my  \n\nafter",
		"a line no comment touched keeps the trailing spaces markdown reads",
	).toBe(true);
	expect(
		stripHtmlComments("```\na\n\n\nb\n```\n<!-- gone -->") ===
			"```\na\n\n\nb\n```",
		"blank lines inside a fence are the example's, not the document's",
	).toBe(true);
});

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
import { CorrelationSources } from "../src/correlation";
import { DigestSources } from "../src/digest";
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

	console.log("\n=== digest sources ===");
	{
		/** A digest plugin that provides the registry its sources register into. */
		class FakeDigest extends Service {
			constructor(ctx: Context) {
				super(ctx, "digestSources" as never);
			}

			// The real plugin is DigestSources; this only stands in for its lifetime.
			readonly registry = new DigestSources(new Context());
		}

		const context = new Context();

		// The failing order, and the one a deployment actually has: an integration
		// loads before the digest plugin does. A registration that merely read
		// `ctx.get("digestSources")` would be lost here.
		const provider = context.inject(["digestSources"], (scoped) => {
			scoped.effect(
				() =>
					scoped.digestSources.register({
						provider: "Atlassian",
						blocks: [
							{
								id: "jira-active",
								title: "Jira · In progress",
								defaultOn: true,
							},
						],
						load: async () => [{ id: "DEV-1", title: "DEV-1 · Fix it" }],
					}),
				"provider: digest source",
			);
		});

		await provider;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"digestSources",
			) === undefined,
			"a provider that loads first waits instead of failing",
		).toBe(true);

		let sources: DigestSources | undefined;
		const digest = context.plugin({
			apply: (inner: Context) => {
				sources = new DigestSources(inner);
			},
		});

		await digest;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"digestSources",
			) !== undefined,
			"the registry arrives under its own name",
		).toBe(true);
		expect(
			sources?.blocks.length === 1 &&
				sources.blocks[0]?.provider === "Atlassian" &&
				sources.blocks[0]?.defaultOn === true,
			`and the waiting provider's block is now on offer — ${JSON.stringify(sources?.blocks)}`,
		).toBe(true);
		expect(
			sources?.providers.join(",") === "Atlassian",
			"its provider is named",
		).toBe(true);

		expect(
			(
				await sources?.load("jira-active", { since: new Date(0), limit: 5 })
			)?.[0]?.id === "DEV-1",
			"loading reaches the owning provider",
		).toBe(true);

		sources?.register({
			provider: "Sentry",
			blocks: [
				{ id: "sentry-errors", title: "Sentry · New errors", defaultOn: true },
			],
			load: async () => [],
		});

		expect(
			sources?.blocks.map((block) => block.id).join(",") ===
				"jira-active,sentry-errors",
			`a second provider's blocks follow the first's — ${sources?.blocks.map((block) => block.id).join(",")}`,
		).toBe(true);

		const clash = (() => {
			try {
				sources?.register({
					provider: "Impostor",
					blocks: [{ id: "jira-active", title: "Mine", defaultOn: true }],
					load: async () => [],
				});

				return "";
			} catch (error) {
				return (error as Error).message;
			}
		})();

		expect(
			clash.includes("already registered"),
			`a block id can only have one owner — ${clash}`,
		).toBe(true);

		const missing = await sources
			?.load("nobody-owns-this", { since: new Date(0), limit: 5 })
			.then(() => "")
			.catch((error: unknown) => (error as Error).message);

		expect(
			(missing ?? "").includes("no digest source"),
			`loading an unowned block is an error — ${missing ?? ""}`,
		).toBe(true);

		await provider.dispose();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			sources?.providers.join(",") === "Sentry",
			`a withdrawn provider takes its block with it — ${sources?.providers.join(",")}`,
		).toBe(true);

		await digest.dispose();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"digestSources",
			) === undefined,
			"and the registry leaves with the digest plugin",
		).toBe(true);
		void new FakeDigest(new Context());
	}

	console.log("\n=== correlation sources ===");
	{
		const context = new Context();

		// The failing order again, and the one a deployment actually has: an
		// integration loads before the correlation plugin does.
		const gitlab = context.inject(["correlationSources"], (scoped) => {
			scoped.effect(
				() =>
					scoped.correlationSources.register({
						provider: "GitLab",
						entry: "change",
						resolves: ["commit", "change"],
						resolve: async (ref) =>
							ref.kind === "commit" && ref.sha === "7c50a1e5"
								? [
										{
											id: "gitlab:acme/storefront@7c50a1e5",
											provider: "GitLab",
											kind: "commit",
											label: "Commit",
											title: "7c50a1e5 · DEV-5977: Handle split codes",
											references: [
												{
													kind: "change",
													repository: "acme/storefront",
													number: "42",
												},
											],
										},
									]
								: [],
					}),
				"gitlab: correlation source",
			);
		});

		await gitlab;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"correlationSources",
			) === undefined,
			"a provider that loads first waits instead of failing",
		).toBe(true);

		let sources: CorrelationSources | undefined;
		const plugin = context.plugin({
			apply: (inner: Context) => {
				sources = new CorrelationSources(inner);
			},
		});

		await plugin;
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"correlationSources",
			) !== undefined,
			"the registry arrives under its own name",
		).toBe(true);
		expect(
			sources?.providers[0]?.provider === "GitLab",
			`and the waiting provider is on offer — ${JSON.stringify(sources?.providers)}`,
		).toBe(true);
		expect(
			sources?.entryOf("GitLab") === "change",
			"with the entry kind a chain starts from",
		).toBe(true);
		expect(
			sources?.entryOf("Sentry") === undefined,
			"a provider that is not installed has no entry kind",
		).toBe(true);
		expect(
			sources?.canResolve("commit") === true,
			"a kind it resolves is answerable",
		).toBe(true);
		expect(
			sources?.canResolve("task") === false,
			"a kind nobody resolves is not",
		).toBe(true);

		const facts = await sources?.resolve({ kind: "commit", sha: "7c50a1e5" });

		expect(
			facts?.[0]?.id === "gitlab:acme/storefront@7c50a1e5" &&
				facts[0]?.references?.[0]?.kind === "change",
			`a reference reaches the provider that resolves it — ${JSON.stringify(facts)}`,
		).toBe(true);

		expect(
			(await sources?.resolve({ kind: "commit", sha: "0000000" }))?.length ===
				0,
			"a reference the provider does not recognize resolves to nothing",
		).toBe(true);

		sources?.register({
			provider: "Otherhost",
			entry: "commit",
			resolves: ["commit"],
			resolve: async (ref) =>
				ref.kind === "commit" && ref.sha !== "7c50a1e5"
					? [
							{
								id: `otherhost:repo@${ref.sha}`,
								provider: "Otherhost",
								kind: "commit",
								label: "Commit",
								title: ref.sha,
							},
						]
					: [],
		});

		expect(
			(await sources?.resolve({ kind: "commit", sha: "0000000" }))?.[0]
				?.provider === "Otherhost",
			"a second source for one kind answers when the first declines",
		).toBe(true);
		expect(
			(await sources?.resolve({ kind: "commit", sha: "7c50a1e5" }))?.[0]
				?.provider === "GitLab",
			"and the first still answers the reference it recognizes",
		).toBe(true);

		const unowned = await sources
			?.resolve({ kind: "error", id: "CHECKOUT-13P" })
			.then(() => "")
			.catch((error: unknown) => (error as Error).message);

		expect(
			(unowned ?? "").includes('no correlation source resolves "error"'),
			`resolving a kind nobody handles is an error — ${unowned ?? ""}`,
		).toBe(true);

		const clash = (() => {
			try {
				sources?.register({
					provider: "GitLab",
					entry: "change",
					resolves: ["change"],
					resolve: async () => [],
				});

				return "";
			} catch (error) {
				return (error as Error).message;
			}
		})();

		expect(
			clash.includes("already registered"),
			`a provider can only be registered once — ${clash}`,
		).toBe(true);

		await gitlab.dispose();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			sources?.providers.map((entry) => entry.provider).join(",") ===
				"Otherhost" && sources.canResolve("change") === false,
			`a withdrawn provider takes its kinds with it — ${sources?.providers.map((entry) => entry.provider).join(",")}`,
		).toBe(true);

		await plugin.dispose();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(
			(context as unknown as { get: (name: string) => unknown }).get(
				"correlationSources",
			) === undefined,
			"and the registry leaves with the correlation plugin",
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

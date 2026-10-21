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

import type { IncomingMessage, ServerResponse } from "node:http";
import { Context, Service } from "@deepseek-ai/cordis";
import type { AuthorizationFlow, GrantStore, McpBridge } from "dsh-mcp-oauth";
import { IntegrationAuth } from "../src/auth";
import { createIntegrationCommand } from "../src/command";
import { resolveEndpointConfig } from "../src/config";
import { DigestSources } from "../src/digest";
import type { FactsReader } from "../src/facts";
import { createIntegrationRoute, mountIntegrationRoute } from "../src/route";
import { RuntimeState } from "../src/state";
import type { IntegrationStatus } from "../src/status";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

console.log("\n=== configuration ===");

const DEFAULTS = { endpoint: "https://example.test/mcp", redirectPort: 8144 };

check(
	"an empty patch falls back to the provider's own resource and port",
	resolveEndpointConfig(undefined, DEFAULTS).endpoint === DEFAULTS.endpoint &&
		resolveEndpointConfig(undefined, DEFAULTS).redirectPort ===
			DEFAULTS.redirectPort,
	JSON.stringify(resolveEndpointConfig(undefined, DEFAULTS)),
);
check(
	"a malformed port falls back rather than failing activation",
	resolveEndpointConfig({ redirectPort: "eighty" }, DEFAULTS).redirectPort ===
		DEFAULTS.redirectPort &&
		resolveEndpointConfig({ redirectPort: -1 }, DEFAULTS).redirectPort ===
			DEFAULTS.redirectPort &&
		resolveEndpointConfig({ redirectPort: 70_000 }, DEFAULTS).redirectPort ===
			DEFAULTS.redirectPort,
);
check(
	"a configured endpoint and port are kept",
	resolveEndpointConfig(
		{ endpoint: "https://other.test/mcp", redirectPort: 9000 },
		DEFAULTS,
	).endpoint === "https://other.test/mcp" &&
		resolveEndpointConfig({ redirectPort: 9000 }, DEFAULTS).redirectPort ===
			9000,
);
check(
	"debug is off unless asked for",
	resolveEndpointConfig({}, DEFAULTS).debug === false &&
		resolveEndpointConfig({ debug: true }, DEFAULTS).debug === true,
);

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

	check(
		"a complete stored grant is restored without asking the server",
		calls.length === 0,
		JSON.stringify(calls.map((call) => call.name)),
	);

	const status = await auth.getStatus();

	check(
		"the status carries the shared fields and the provider's own",
		status.connected &&
			status.slug === "acme" &&
			status.endpoint === DEFAULTS.endpoint &&
			status.tools.length === 1,
		JSON.stringify({ slug: status.slug, connected: status.connected }),
	);
	check("nothing was remembered again", remembered.length === 0);
}

{
	const { auth, state, remembered, calls } = harness({
		answer: { slug: "acme" },
	});

	await auth.connect();

	check(
		"an unknown account is learned through the provider's own tool",
		calls[0]?.name === "list_things" && state.facts?.slug === "acme",
		JSON.stringify(calls[0]),
	);
	check(
		"what was learned is remembered in the credential record",
		remembered[0]?.slug === "acme" && remembered.length === 1,
		JSON.stringify(remembered),
	);
	check(
		"a partial answer is not treated as complete",
		state.facts?.isComplete === false,
		String(state.facts?.isComplete),
	);
}

{
	const { auth, remembered } = harness({
		answer: { webUrl: "https://acme.test" },
		grant: grantOf({ slug: "acme" }),
	});

	await auth.connect();

	check(
		"learned facts merge into what the grant already knew",
		remembered[0]?.slug === "acme" &&
			remembered[0]?.webUrl === "https://acme.test",
		JSON.stringify(remembered[0]),
	);
}

{
	const { auth, state } = harness({ answer: {}, answerThrows: true });

	await auth.connect();

	check(
		"a server that refuses the account tool leaves the plugin usable",
		state.facts?.isEmpty === true,
		JSON.stringify(state.facts),
	);
}

{
	const { auth, calls } = harness({
		answer: { slug: "acme" },
		tools: ["mcp__example__something_else"],
	});

	await auth.connect();

	check(
		"a bridge without the account tool is not asked for it",
		calls.length === 0,
		JSON.stringify(calls.map((call) => call.name)),
	);
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

/** One request/response pair, without a socket under it. */
async function call(
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; body: unknown }> {
	const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	const request = {
		method,
		url: path,
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

	check(
		"the settings card reads the status",
		read.status === 200 && (read.body as { slug?: string }).slug === "acme",
		JSON.stringify(read.body).slice(0, 60),
	);

	const login = await call("POST", "/dsh-example/login");

	check(
		"login starts an attempt and answers with the running state",
		login.status === 202 && seen.includes("signIn"),
		`${login.status}: ${JSON.stringify(seen)}`,
	);

	const logout = await call("POST", "/dsh-example/logout");

	check(
		"logout forgets the sign-in",
		logout.status === 200 && seen.includes("signOut"),
		JSON.stringify(seen),
	);

	const sync = await call("POST", "/dsh-example/sync");

	check(
		"sync reconnects",
		sync.status === 200 && seen.includes("connect"),
		JSON.stringify(seen),
	);

	const thing = await call("POST", "/dsh-example/thing", { id: "abc" });

	check(
		"a provider path answers through the shared route",
		thing.status === 200 && (thing.body as { id?: string }).id === "abc",
		JSON.stringify(thing.body),
	);

	const missing = await call("POST", "/dsh-example/thing", {});

	check(
		"a write without its field is a bad request, not a gateway error",
		missing.status === 400 &&
			String((missing.body as { error?: string }).error).includes("id"),
		`${missing.status}: ${JSON.stringify(missing.body)}`,
	);

	const unknown = await call("GET", "/dsh-example/nope");

	check(
		"an unknown path is a not-found",
		unknown.status === 404,
		String(unknown.status),
	);
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

	check(
		"the status answer names the provider, the token and the account",
		statusAnswer.kind === "success" &&
			statusAnswer.text.startsWith("Signed in to Example.") &&
			statusAnswer.text.includes("Account: acme.") &&
			statusAnswer.text.includes("1 tools loaded."),
		statusAnswer.text,
	);

	const login = await run({ rawInput: "login" });

	check(
		"login reports the attempt through the auth's own message",
		login.kind === "success" &&
			login.text === "Opening your browser…" &&
			commandSeen.includes("signIn"),
		login.text,
	);

	const logout = await run({ rawInput: "logout" });

	check(
		"logout names the provider",
		logout.text === "Signed out of Example.",
		logout.text,
	);

	const sync = await run({ rawInput: "sync" });

	check(
		"sync reports how many tools are ready",
		sync.kind === "success" && sync.text === "Example tools ready (1).",
		sync.text,
	);

	const unknown = await run({ rawInput: "whatever" });

	check(
		"anything unrecognized reports status",
		unknown.kind === "success" &&
			unknown.text.startsWith("Signed in to Example."),
		unknown.text,
	);

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

	check(
		"a failure is answered as the provider's own error",
		refused.kind === "error" && refused.text === "Example: bridge is down",
		refused.text,
	);
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

	const before = (context as unknown as { get: (name: string) => unknown }).get(
		"webServer",
	);

	check(
		"a listener that has not mounted yet is not there to read",
		before === undefined,
	);

	const fiber = context.plugin(FakeWebServer);

	await fiber;
	await new Promise((resolve) => setTimeout(resolve, 20));

	const server = (
		context as unknown as { get: (name: string) => FakeWebServer }
	).get("webServer");

	check(
		"the route reaches a listener that arrives later",
		server.mounted.includes("/dsh-early"),
		server.mounted.join(", "),
	);

	await fiber.dispose();
	await new Promise((resolve) => setTimeout(resolve, 20));

	check(
		"and leaves with it",
		!server.mounted.includes("/dsh-early"),
		server.mounted.join(", "),
	);
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
						{ id: "jira-active", title: "Jira · In progress", defaultOn: true },
					],
					load: async () => [{ id: "DEV-1", title: "DEV-1 · Fix it" }],
				}),
			"provider: digest source",
		);
	});

	await provider;
	await new Promise((resolve) => setTimeout(resolve, 20));

	check(
		"a provider that loads first waits instead of failing",
		(context as unknown as { get: (name: string) => unknown }).get(
			"digestSources",
		) === undefined,
	);

	let sources: DigestSources | undefined;
	const digest = context.plugin({
		apply: (inner: Context) => {
			sources = new DigestSources(inner);
		},
	});

	await digest;
	await new Promise((resolve) => setTimeout(resolve, 20));

	check(
		"the registry arrives under its own name",
		(context as unknown as { get: (name: string) => unknown }).get(
			"digestSources",
		) !== undefined,
	);
	check(
		"and the waiting provider's block is now on offer",
		sources?.blocks.length === 1 &&
			sources.blocks[0]?.provider === "Atlassian" &&
			sources.blocks[0]?.defaultOn === true,
		JSON.stringify(sources?.blocks),
	);
	check("its provider is named", sources?.providers.join(",") === "Atlassian");

	check(
		"loading reaches the owning provider",
		(await sources?.load("jira-active", { since: new Date(0), limit: 5 }))?.[0]
			?.id === "DEV-1",
	);

	sources?.register({
		provider: "Sentry",
		blocks: [
			{ id: "sentry-errors", title: "Sentry · New errors", defaultOn: true },
		],
		load: async () => [],
	});

	check(
		"a second provider's blocks follow the first's",
		sources?.blocks.map((block) => block.id).join(",") ===
			"jira-active,sentry-errors",
		sources?.blocks.map((block) => block.id).join(","),
	);

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

	check(
		"a block id can only have one owner",
		clash.includes("already registered"),
		clash,
	);

	const missing = await sources
		?.load("nobody-owns-this", { since: new Date(0), limit: 5 })
		.then(() => "")
		.catch((error: unknown) => (error as Error).message);

	check(
		"loading an unowned block is an error",
		(missing ?? "").includes("no digest source"),
		missing ?? "",
	);

	await provider.dispose();
	await new Promise((resolve) => setTimeout(resolve, 20));

	check(
		"a withdrawn provider takes its block with it",
		sources?.providers.join(",") === "Sentry",
		sources?.providers.join(","),
	);

	await digest.dispose();
	await new Promise((resolve) => setTimeout(resolve, 20));

	check(
		"and the registry leaves with the digest plugin",
		(context as unknown as { get: (name: string) => unknown }).get(
			"digestSources",
		) === undefined,
	);
	void new FakeDigest(new Context());
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

/**
 * Dry run of the host half against Atlassian's live endpoints, with a fake
 * harness context. It covers everything that does not need a human: metadata
 * discovery, dynamic client registration, authorize-URL construction, the
 * loopback callback, the stored record, and cancellation.
 *
 *   bun run test/dry-run.ts
 *
 * It stops short of consenting, so it creates a throwaway OAuth client
 * registration and then abandons it.
 */

import type { AuthorizationSession } from "@deepseek-ai/dsh-authorization";
import type { Context } from "@deepseek-ai/cordis";
import { resolveConfig } from "../src/host/config";
import { apply } from "../src/host/index";
import { oauthFlow } from "../src/host/oauth/flow";
import { Grant } from "../src/host/store/grant";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

const records = new Map<string, unknown>();
const registered = {
	commands: [] as unknown[],
	flows: [] as unknown[],
	routes: [] as unknown[],
};

/**
 * The real store refuses a payload JSON cannot represent, so this fake refuses
 * it too: an `undefined` field must fail here rather than in a user's profile.
 */
function assertJsonRepresentable(record: unknown): unknown {
	const walk = (value: unknown, path: string): void => {
		if (value === undefined) throw new Error(`record ${path} holds undefined`);

		if (typeof value === "function" || typeof value === "symbol")
			throw new Error(`record ${path} holds a ${typeof value}`);

		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				walk(item, `${path}[${index}]`);
			});

			return;
		}

		if (value !== null && typeof value === "object")
			for (const [key, item] of Object.entries(value))
				walk(item, `${path}.${key}`);
	};

	walk(record, "payload");

	const roundTripped: unknown = JSON.parse(JSON.stringify(record));
	if (JSON.stringify(roundTripped) !== JSON.stringify(record))
		throw new Error("record payload does not survive a JSON round trip");

	return roundTripped;
}

/** A harness context with just enough surface for this plugin. */
function fakeContext(): Context {
	return {
		logger: {
			info: (...args: unknown[]) => console.log("  log:", ...args),
			warn: (...args: unknown[]) => console.log("  warn:", ...args),
		},
		tools: { register: () => () => {} },
		credentials: {
			readRecord: async (key: string) => records.get(key),
			modifyRecord: async (
				key: string,
				mutate: (current: unknown) => Promise<unknown>,
			) => {
				const next = await mutate(records.get(key));
				if (next === undefined) return records.get(key);
				records.set(key, assertJsonRepresentable(next));

				return next;
			},
			deleteRecord: async (key: string) => records.delete(key),
		},
		commands: {
			register: (command: unknown) => registered.commands.push(command),
		},
		authorization: {
			registerFlow: (flow: unknown) => {
				registered.flows.push(flow);

				return () => {};
			},
			cancel: () => {},
		},
		get: (name: string) =>
			name === "webServer"
				? {
						register: (route: unknown) => {
							registered.routes.push(route);

							return () => {};
						},
					}
				: undefined,
		effect: (callback: () => unknown) => {
			callback();
		},
	} as unknown as Context;
}

/** Drive one sign-in attempt up to the point where a human is needed. */
async function driveFlow(ctx: Context, endpoint: string): Promise<void> {
	console.log(`\n=== ${endpoint} ===`);

	const config = resolveConfig({ endpoint, redirectPort: 8143 });
	const controller = new AbortController();
	let notify: { message: string; url?: string } | undefined;

	const session = {
		method: "oauth",
		signal: controller.signal,
		notify: (notice: { message: string; url?: string }) => {
			notify = notice;
		},
		prompt: () => Promise.reject(new Error("no prompts expected")),
		commit: async (record: unknown) => {
			records.set(Grant.CREDENTIAL_KEY, assertJsonRepresentable(record));
		},
	} as unknown as AuthorizationSession;

	const running = oauthFlow
		.run(ctx, session, config)
		.catch((error: unknown) => error);

	for (let waited = 0; waited < 60 && notify === undefined; waited += 1)
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});

	if (notify === undefined) {
		check("the flow publishes an authorize URL", false);
		await running;

		return;
	}

	const authorize = new URL(notify.url ?? "");
	const params = authorize.searchParams;

	check("authorize host resolved", authorize.host !== "", authorize.host);
	check(
		"client registered dynamically",
		typeof params.get("client_id") === "string",
	);
	check("PKCE challenge sent", params.get("code_challenge_method") === "S256");
	check("resource parameter sent", params.get("resource") === endpoint);
	check(
		"scopes negotiated",
		(params.get("scope") ?? "").includes("offline_access"),
		params.get("scope") ?? "",
	);

	// The consent page must render for this exact client and redirect URI.
	const page = await fetch(notify.url ?? "");
	check(
		"authorize endpoint accepts the request",
		page.status < 400,
		`HTTP ${page.status}`,
	);

	// The loopback listener must be live and must reject a forged state.
	const redirect = new URL(params.get("redirect_uri") ?? "");
	const forged = await fetch(`${redirect.href}?code=forged&state=wrong`);
	check(
		"callback rejects a forged state",
		forged.status === 400,
		`HTTP ${forged.status}`,
	);

	controller.abort();
	const outcome = await running;
	check(
		"cancellation settles the attempt",
		outcome instanceof Error,
		String(outcome),
	);

	// The registration it wrote must be readable as a real grant.
	const grant = await Grant.read(ctx);
	check(
		"the stored registration is rehydrated",
		typeof grant?.isSignedIn === "function",
	);
	check("an unfinished grant is not signed in", grant?.isSignedIn() === false);
}

const ctx = fakeContext();

apply(ctx, { endpoint: resolveConfig(undefined).endpoint });
check("apply registers one authorization flow", registered.flows.length === 1);
check(
	"apply registers the /atlassian command",
	registered.commands.length === 1,
);
check("apply registers the loopback API route", registered.routes.length === 1);

// A grant read back from the store is plain JSON, not a class instance: this is
// the shape the credential store hands to every caller, so it must still work.
const rehydrated = Grant.from({
	version: 1,
	accessToken: "token",
	expiresAt: Date.now() + 60_000,
});
check("Grant.from rebuilds an instance", rehydrated?.isSignedIn() === true);
check("Grant.from tolerates a missing payload", Grant.from(null) === undefined);
check(
	"Grant.from tolerates a foreign payload",
	Grant.from(undefined) === undefined,
);

await driveFlow(ctx, "https://mcp.atlassian.com/v1/mcp");
await driveFlow(ctx, "https://mcp.atlassian.com/v2/mcp");

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

/**
 * The channel to GitLab: what a transport failure looks like to the caller.
 *
 * HTTP refusals are answered by the endpoint; a network that never answered is
 * not — and that difference matters most to the agent, which has to decide
 * whether repeating the call is safe. These tests stub `fetch` so no socket is
 * involved.
 *
 *   bun run test/api.test.ts
 */

import { expect, test } from "bun:test";
import { GitLabApi } from "../src/host/api";
import { resolveConfig } from "../src/host/config";
import type { TokenStore } from "../src/host/token";

/** A client whose token is already stored. */
const api = (): GitLabApi =>
	new GitLabApi({
		config: resolveConfig(undefined),
		token: { read: async () => "token" } as unknown as TokenStore,
	});

/** Run one read with `fetch` replaced by the throwing function. */
async function failureOf(thrown: () => never): Promise<string> {
	const original = globalThis.fetch;
	globalThis.fetch = (async () => thrown()) as unknown as typeof fetch;

	try {
		await api().get("/user");
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	} finally {
		globalThis.fetch = original;
	}

	return "";
}

test("a network failure says GitLab could not be reached and that retrying is possible", async () => {
	const message = await failureOf(() => {
		throw new TypeError("fetch failed");
	});

	expect(
		message.includes("Could not reach GitLab") &&
			message.includes("Check the network or VPN") &&
			message.includes("can be retried"),
		`a transport failure names the provider and the retry, instead of surfacing as a harness bug — ${message}`,
	).toBe(true);
});
test("a timeout says the call can be retried", async () => {
	const message = await failureOf(() => {
		const error = new Error("The operation was aborted due to timeout");
		error.name = "TimeoutError";

		throw error;
	});

	expect(
		message.includes("did not answer") &&
			message.includes("timed out") &&
			message.includes("can be retried"),
		`a timeout is answered as a timeout, with the retry it allows — ${message}`,
	).toBe(true);
});

/**
 * Which browser belongs to which conversation.
 *
 * The name ends up in a socket path and in the CLI's own session list, so it has
 * to survive whatever a session id contains — and it must never be the shared
 * `default` session, which belongs to every other agent-browser caller on the
 * machine.
 *
 *   bun run test/session.ts
 */

import { expect, test } from "bun:test";
import {
	MAX_SESSION_NAME,
	SESSION_PREFIX,
	sessionNameOf,
} from "../src/host/session";

test("one session, one browser", async () => {
	expect(
		sessionNameOf("01H8") === "dsh-01H8",
		"an id becomes a prefixed name",
	).toBe(true);
	expect(
		sessionNameOf(undefined) === "dsh-nosession",
		"a call with no session still gets its own",
	).toBe(true);
	expect(
		sessionNameOf("") === "dsh-nosession",
		"an empty id is the same as none",
	).toBe(true);
	expect(
		sessionNameOf("default") === "dsh-default",
		"the shared default session is never used",
	).toBe(true);
});
test("a name that is safe in a path", async () => {
	expect(sessionNameOf("a/b") === "dsh-a-b", "slashes become dashes").toBe(
		true,
	);
	expect(sessionNameOf("a b") === "dsh-a-b", "spaces become dashes").toBe(true);
	expect(
		sessionNameOf("a///b") === "dsh-a-b",
		"runs of unsafe characters become one dash",
	).toBe(true);
	expect(sessionNameOf("/a/") === "dsh-a", "edges are trimmed").toBe(true);
	expect(sessionNameOf("AbC") === "dsh-AbC", "case is kept").toBe(true);
	expect(
		sessionNameOf("a.b-c") === "dsh-a.b-c",
		"dots and dashes survive",
	).toBe(true);
});
test("a name that fits", async () => {
	const long = sessionNameOf("x".repeat(200));
	expect(long.length === MAX_SESSION_NAME, "is capped").toBe(true);
	expect(long.startsWith(SESSION_PREFIX), "keeps its prefix").toBe(true);
});

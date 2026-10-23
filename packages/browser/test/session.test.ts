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

import { test } from "bun:test";
import { check } from "../../../test/support";
import {
	MAX_SESSION_NAME,
	SESSION_PREFIX,
	sessionNameOf,
} from "../src/host/session";

test("one session, one browser", async () => {
	check("an id becomes a prefixed name", sessionNameOf("01H8") === "dsh-01H8");
	check(
		"a call with no session still gets its own",
		sessionNameOf(undefined) === "dsh-nosession",
	);
	check(
		"an empty id is the same as none",
		sessionNameOf("") === "dsh-nosession",
	);
	check(
		"the shared default session is never used",
		sessionNameOf("default") === "dsh-default",
	);
});
test("a name that is safe in a path", async () => {
	check("slashes become dashes", sessionNameOf("a/b") === "dsh-a-b");
	check("spaces become dashes", sessionNameOf("a b") === "dsh-a-b");
	check(
		"runs of unsafe characters become one dash",
		sessionNameOf("a///b") === "dsh-a-b",
	);
	check("edges are trimmed", sessionNameOf("/a/") === "dsh-a");
	check("case is kept", sessionNameOf("AbC") === "dsh-AbC");
	check("dots and dashes survive", sessionNameOf("a.b-c") === "dsh-a.b-c");
});
test("a name that fits", async () => {
	const long = sessionNameOf("x".repeat(200));
	check("is capped", long.length === MAX_SESSION_NAME);
	check("keeps its prefix", long.startsWith(SESSION_PREFIX));
});

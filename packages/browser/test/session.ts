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

import {
	MAX_SESSION_NAME,
	SESSION_PREFIX,
	sessionNameOf,
} from "../src/host/session";
import { check, report, section } from "./harness";

section("one session, one browser");
check("an id becomes a prefixed name", sessionNameOf("01H8") === "dsh-01H8");
check(
	"a call with no session still gets its own",
	sessionNameOf(undefined) === "dsh-nosession",
);
check("an empty id is the same as none", sessionNameOf("") === "dsh-nosession");
check(
	"the shared default session is never used",
	sessionNameOf("default") === "dsh-default",
);

section("a name that is safe in a path");
check("slashes become dashes", sessionNameOf("a/b") === "dsh-a-b");
check("spaces become dashes", sessionNameOf("a b") === "dsh-a-b");
check(
	"runs of unsafe characters become one dash",
	sessionNameOf("a///b") === "dsh-a-b",
);
check("edges are trimmed", sessionNameOf("/a/") === "dsh-a");
check("case is kept", sessionNameOf("AbC") === "dsh-AbC");
check("dots and dashes survive", sessionNameOf("a.b-c") === "dsh-a.b-c");

section("a name that fits");
const long = sessionNameOf("x".repeat(200));
check("is capped", long.length === MAX_SESSION_NAME);
check("keeps its prefix", long.startsWith(SESSION_PREFIX));

report();

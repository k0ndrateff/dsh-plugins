/**
 * Which browser belongs to which harness session.
 *
 * One browser per session: two agents working at once must not fight over one
 * page, and a page left open by an earlier conversation must not become this
 * one's starting point. The name is derived from the harness session id, so the
 * same conversation always lands on the same browser — and a `bash` call that
 * names that session reaches the same daemon.
 *
 * Both halves derive the name with this file, because both must arrive at the
 * same one: the host for the tools, and the panel for the browser it watches.
 * The shared `default` session is deliberately not used: it belongs to every
 * other agent-browser caller on the machine.
 */

/** What every session's browser is named with, so its daemon is ours. */
export const SESSION_PREFIX = "dsh-";

/** The longest session name this plugin builds, in characters. */
export const MAX_SESSION_NAME = 40;

/** The name used when a call arrives without a session behind it. */
const NO_SESSION = "nosession";

/**
 * Everything a session name may contain, so it is safe in a socket path.
 *
 * Case is kept: two session ids that differ only in case are two sessions, and
 * folding them together would hand one conversation another's page.
 */
const sanitize = (value: string): string =>
	value
		.replace(/[^A-Za-z0-9._-]+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^[-.]+|[-.]+$/gu, "");

/**
 * The browser one harness session owns.
 * @param sessionId - the calling session's id, when there is one.
 */
export const sessionNameOf = (sessionId: string | undefined): string => {
	const cleaned = sanitize(sessionId ?? "");
	const room = MAX_SESSION_NAME - SESSION_PREFIX.length;

	return `${SESSION_PREFIX}${(cleaned === "" ? NO_SESSION : cleaned).slice(0, room)}`;
};

/**
 * Whether a name is one this plugin builds.
 *
 * The panel asks for a browser by name, so the name it may ask for has to be
 * recognised rather than trusted: a hub for a fabricated session would make the
 * plugin ask the CLI about a browser that was never there.
 * @param value - the name a caller sent.
 */
export const isSessionName = (value: string): boolean =>
	new RegExp(
		`^${SESSION_PREFIX}[A-Za-z0-9._-]{1,${MAX_SESSION_NAME - SESSION_PREFIX.length}}$`,
		"u",
	).test(value);

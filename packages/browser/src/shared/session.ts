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

/** A short stable fingerprint, so two long ids that share a prefix stay apart. */
const fingerprint = (value: string): string => {
	let hash = 2166136261;

	for (const character of value) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}

	return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
};

/**
 * The browser one harness session owns.
 * @param sessionId - the calling session's id, when there is one.
 */
export const sessionNameOf = (sessionId: string | undefined): string => {
	const cleaned = sanitize(sessionId ?? "");
	const name = cleaned === "" ? NO_SESSION : cleaned;
	const room = MAX_SESSION_NAME - SESSION_PREFIX.length;

	if (name.length <= room) return `${SESSION_PREFIX}${name}`;

	// A plain prefix cut would map every long id with the same head to one
	// browser; the fingerprint keeps them apart without breaking the length cap.
	return `${SESSION_PREFIX}${name.slice(0, room - 7)}-${fingerprint(name)}`;
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

/**
 * Reading what the CLI answered.
 *
 * Every command is run with `--json`, and the CLI answers with one document:
 * `{success, data, error}`, on success and failure alike. Anything else on stdout
 * means the CLI did not answer the way this plugin knows, and saying so is
 * better than reading a fragment as if it were the whole answer.
 */

/** One answer from the CLI, after it is known to be one. */
export interface Envelope {
	/** Whether the command did what it was asked. */
	readonly ok: boolean;
	/** The command's own payload; absent on some failures. */
	readonly data: unknown;
	/** The CLI's reason, when it gave one. */
	readonly error: string | undefined;
}

/** Answer fields that ride every response and belong to nobody's question. */
const NOISE = ["lifecycle", "targetId"];

/**
 * Read one JSON answer.
 * @param stdout - everything the command wrote to stdout.
 * @returns the answer, or undefined when stdout is not one this plugin knows —
 *   which is how `doctor`'s own report is told apart from a command's.
 */
export const parseEnvelope = (stdout: string): Envelope | undefined => {
	const text = stdout.trim();
	if (text === "") return undefined;

	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
		return undefined;

	const record = parsed as Record<string, unknown>;
	const error = typeof record.error === "string" ? record.error : undefined;

	if (record.success === true) return { ok: true, data: record.data, error };
	if (record.success === false) return { ok: false, data: record.data, error };

	return undefined;
};

/**
 * The same answer without the fields that are the same on every call.
 *
 * `lifecycle` describes the daemon's launch and `targetId` names a CDP target:
 * both are identical line after line, and the model pays for them in context
 * every time it reads a page.
 * @param value - one command's payload.
 */
export const modelData = (value: unknown): unknown => {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return value;

	return Object.fromEntries(
		Object.entries(value).filter(([key]) => !NOISE.includes(key)),
	);
};

/**
 * One named field of an answer, when it came as the type it should have.
 * @param value - one command's payload, already stripped of its noise.
 */
export const fieldOf = <T>(
	value: unknown,
	key: string,
	guard: (field: unknown) => field is T,
): T | undefined => {
	if (value === null || typeof value !== "object") return undefined;

	const field = (value as Record<string, unknown>)[key];

	return guard(field) ? field : undefined;
};

/** Whether a payload field is a string. */
export const isText = (value: unknown): value is string =>
	typeof value === "string";

/** Whether a payload field is a list. */
export const isList = (value: unknown): value is readonly unknown[] =>
	Array.isArray(value);

/**
 * Whether a payload field is one object with named fields.
 *
 * A snapshot's `refs` is exactly that — `{e1: {name, role}}` — and an array guard
 * would quietly treat every page as having no references at all.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

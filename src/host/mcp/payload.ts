/**
 * Reading an MCP tool result.
 *
 * Atlassian answers with JSON inside text content blocks — and withholds
 * `structuredContent` from clients it does not recognize by name — so both the
 * card extractor and the panel loader start from the same two reads: the text
 * blocks in order, and whatever JSON those blocks carry.
 */

/** The text content blocks of an MCP result, in order. */
export function mcpText(value: unknown): string[] {
	if (value === null || typeof value !== "object") return [];

	const content = (value as { content?: unknown }).content;

	if (!Array.isArray(content)) return [];

	const out: string[] = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;

		const { type, text } = block as { type?: unknown; text?: unknown };

		if (type === "text" && typeof text === "string") out.push(text);
	}

	return out;
}

/**
 * The JSON payloads an MCP result carries.
 *
 * A block that is not JSON is skipped rather than failing the read: a server
 * may answer a successful call with prose, and the caller's text fallback is
 * then the truthful answer.
 */
export function mcpJson(value: unknown): unknown[] {
	const roots: unknown[] = [];

	for (const text of mcpText(value)) {
		const trimmed = text.trim();

		if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;

		try {
			roots.push(JSON.parse(trimmed));
		} catch {
			// Not JSON; nothing to walk.
		}
	}

	return roots;
}

/** Whether a value is a plain object, which every payload record is. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** The first non-empty string among a record's named fields. */
export function pickString(
	source: unknown,
	...names: string[]
): string | undefined {
	const record = asRecord(source);
	if (record === undefined) return undefined;

	for (const name of names) {
		const value = record[name];

		if (typeof value === "string" && value.trim() !== "") return value.trim();
		if (typeof value === "number") return String(value);
	}

	return undefined;
}

/** The first finite number among a record's named fields. */
export function pickNumber(
	source: unknown,
	...names: string[]
): number | undefined {
	const record = asRecord(source);
	if (record === undefined) return undefined;

	for (const name of names) {
		const value = record[name];

		if (typeof value === "number" && Number.isFinite(value)) return value;

		if (typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);

			if (Number.isFinite(parsed)) return parsed;
		}
	}

	return undefined;
}

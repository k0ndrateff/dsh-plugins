/**
 * The credential store persists a record payload through JSON, and refuses a
 * value JSON cannot represent. Dynamic client registration legitimately leaves
 * fields absent (`client_secret`, `site_url`), so every payload is normalized
 * before it is written instead of leaking `undefined` into the store.
 */

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * Copy a value, dropping every member JSON cannot carry.
 * @param value - arbitrary record payload.
 * @returns the same shape with `undefined`, functions, and symbols removed.
 */
export function jsonSafe(value: unknown): JsonValue | undefined {
	if (Array.isArray(value)) {
		const items: JsonValue[] = [];

		for (const item of value) {
			const safe = jsonSafe(item);

			if (safe !== undefined) items.push(safe);
		}

		return items;
	}

	if (value !== null && typeof value === "object") {
		const out: { [key: string]: JsonValue } = {};

		for (const [key, item] of Object.entries(value)) {
			const safe = jsonSafe(item);

			if (safe !== undefined) out[key] = safe;
		}

		return out;
	}

	if (
		value === undefined ||
		typeof value === "function" ||
		typeof value === "symbol"
	)
		return undefined;

	if (typeof value === "number" && !Number.isFinite(value)) return undefined;

	return value as JsonValue;
}

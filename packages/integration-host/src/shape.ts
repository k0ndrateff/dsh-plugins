/**
 * A small, declarative reader for the documents the two halves exchange.
 *
 * The browser half has to distrust whatever the host sent: the halves can be a
 * version apart while a plugin is being developed. These readers say what a
 * document is, field by field, and drop a top-level document whose required
 * field is missing. Optional fields that are absent stay absent in the result,
 * so a card never grows `{ "url": undefined }`.
 *
 * This is deliberately not a schema library: it has no inference tricks and no
 * dependencies, and every reader is a plain function a test can call.
 */

/** A function that reads one value, or answers undefined when it is not one. */
export type Reader<T> = (value: unknown) => T | undefined;

/** One field of an object, and whether its absence invalidates the object. */
export interface Field<T> {
	readonly read: Reader<T>;
	readonly isRequired: boolean;
}

/** A field that must be present and valid. */
export const required = <T>(read: Reader<T>): Field<T> => ({
	read,
	isRequired: true,
});

/** A field that may be absent; an invalid value is treated as absent. */
export const optional = <T>(read: Reader<T>): Field<T | undefined> => ({
	read,
	isRequired: false,
});

/** A field with a value when the document leaves it out or malforms it. */
export const fallback = <T>(read: Reader<T>, value: T): Field<T> => ({
	read: (input) => read(input) ?? value,
	isRequired: true,
});

/** Whether a value is a plain object, not an array or null. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Read a string, including the empty one. */
export const string: Reader<string> = (value) =>
	typeof value === "string" ? value : undefined;

/** Read a string that carries something. */
export const nonEmptyString: Reader<string> = (value) =>
	typeof value === "string" && value !== "" ? value : undefined;

/** Read a finite number. */
export const number: Reader<number> = (value) =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Read a boolean. */
export const boolean: Reader<boolean> = (value) =>
	typeof value === "boolean" ? value : undefined;

/** Read a boolean that is true unless the document says exactly false. */
export const notFalse: Reader<boolean> = (value) => value !== false;

/** Read a boolean that is true only when the document says exactly true. */
export const isTrue: Reader<boolean> = (value) => value === true;

/** Read the value true, and nothing else; false and absence are undefined. */
export const trueOnly: Reader<true> = (value) =>
	value === true ? true : undefined;

/** Read one exact string. */
export const literal =
	<T extends string>(value: T): Reader<T> =>
	(input) =>
		input === value ? value : undefined;

/**
 * Read an array, keeping only the items the item reader accepts.
 *
 * A non-array is an empty list: lists in these documents are always safe to
 * draw, and one malformed item must not hide the others.
 */
export const list =
	<T>(read: Reader<T>): Reader<T[]> =>
	(value) => {
		if (!Array.isArray(value)) return [];

		const items: T[] = [];

		for (const candidate of value) {
			const item = read(candidate);
			if (item !== undefined) items.push(item);
		}

		return items;
	};

/**
 * Build a reader for one object shape.
 *
 * Required fields decide whether the document exists; optional fields are
 * omitted from the result when they are absent, matching what the host sent.
 */
export const object =
	<T>(fields: { [K in keyof T]: Field<T[K]> }): Reader<T> =>
	(value) => {
		if (!isRecord(value)) return undefined;

		const result: Record<string, unknown> = {};

		for (const key of Object.keys(fields) as Array<keyof T & string>) {
			const field = fields[key] as Field<unknown>;
			const parsed = field.read(value[key]);

			if (parsed === undefined) {
				if (field.isRequired) return undefined;

				continue;
			}

			result[key] = parsed;
		}

		return result as unknown as T;
	};

/** Read the first of several shapes that accepts the value. */
export const oneOf =
	<T>(...readers: readonly Reader<T>[]): Reader<T> =>
	(value) => {
		for (const read of readers) {
			const parsed = read(value);
			if (parsed !== undefined) return parsed;
		}

		return undefined;
	};

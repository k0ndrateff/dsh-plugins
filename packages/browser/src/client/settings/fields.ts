/**
 * The settings page's field kinds, and why two of them are written here.
 *
 * The shared form model knows how to stage text; which drafts a field accepts is
 * the field's own business. The harness ships a text and a number kind, and the
 * two this plugin needs beyond them are a switch and a list: a profile's domains
 * are a comma-separated line to the person and an array in the document, and a
 * boolean read as free text would let anyone type a third state into a setting
 * the schema only accepts two of.
 */

import type { SettingsFieldSpec } from "@deepseek-ai/dsh-client-ui-primitives";

/** One field's write: a value, or the clearing that re-inherits the default. */
const clear = { kind: "clear" } as const;

/** A boolean, staged as the two words a person can see it as. */
export const settingsSwitchField = (field: string): SettingsFieldSpec => ({
	field,
	format: (value) => {
		if (typeof value !== "boolean") return "";

		return value ? "true" : "false";
	},
	parse: (text) => {
		const trimmed = text.trim();

		if (trimmed === "") return clear;
		if (trimmed !== "true" && trimmed !== "false") return undefined;

		return { kind: "set", value: trimmed === "true" };
	},
});

/**
 * A list of short strings, staged as one comma-separated line.
 *
 * The value is a list rather than a line because the CLI takes it as a list of
 * patterns and the schema keeps it that way; the control is a line because a
 * person types domains, not JSON.
 */
export const settingsListField = (field: string): SettingsFieldSpec => ({
	field,
	format: (value) => {
		if (!Array.isArray(value)) return "";

		return value.filter((entry) => typeof entry === "string").join(", ");
	},
	parse: (text) => {
		const entries = text
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry !== "");

		return entries.length === 0 ? clear : { kind: "set", value: entries };
	},
});

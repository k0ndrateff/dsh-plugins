/**
 * Biome diagnostics.
 *
 * Biome can say the same thing two ways, and this reads both. Its JSON reporter
 * carries severity, category, and location per diagnostic, so a recipe that
 * writes `biome check --reporter=json` gets an exact reading; the default
 * pretty reporter gets a best-effort one — a header line names the file and the
 * rule, and the first marker under it says whether the diagnostic is an error
 * (`×`) or a warning (`!`).
 *
 * A lint diagnostic's header carries the position; a formatter diagnostic has
 * none, because it is about the whole file — `path format ━━━` — so both header
 * shapes are read and the position is kept only when there is one.
 *
 * The JSON reporter announces itself as experimental on a line before the
 * document, so the document starts at the first brace.
 */

import { isRecord } from "dsh-integration-host/shape";
import {
	type CheckFailure,
	type CheckSummary,
	EMPTY_SUMMARY,
} from "../../shared/checks";
import type { ParsedOutput, Parser } from "./parsed";

/** The header of one pretty diagnostic that names a position. */
const LOCATED =
	/^(?<file>[^\s:][^:]*):(?<line>\d+):(?<column>\d+) (?<category>\S+)/u;

/** The header of one that does not: a formatter diagnostic over a whole file. */
const UNLOCATED =
	/^(?<file>[^\s:][^:]*?) (?<category>(?:lint|assist|syntax|format|project)\S*)(?=\s|$)/u;

/** The marker line that says how severe the diagnostic above it is. */
const MARKER = /^\s*(?<marker>[×!])\s/u;

/** The trailing count lines: `Found 2 errors.`, `Found 1 warning.` */
const FOUND_ERRORS = /Found (\d+) errors?/u;
const FOUND_WARNINGS = /Found (\d+) warnings?/u;

/** One diagnostic of the JSON reporter, as far as this parser reads it. */
interface BiomeDiagnostic {
	readonly severity?: unknown;
	readonly message?: unknown;
	readonly category?: unknown;
	readonly location?: unknown;
}

/** The JSON reporter's document, as far as this parser reads it. */
interface BiomeDocument {
	readonly summary?: unknown;
	readonly diagnostics?: unknown;
}

/** The path one JSON diagnostic names, in either shape the reporter uses. */
function pathOf(location: unknown): string | undefined {
	if (!isRecord(location)) return undefined;

	const path = location.path;

	if (typeof path === "string") return path;
	if (isRecord(path) && typeof path.file === "string") return path.file;

	return undefined;
}

/** The position one JSON diagnostic names. */
function positionOf(location: unknown): { line?: number; column?: number } {
	if (!isRecord(location) || !isRecord(location.start)) return {};

	const line = Number(location.start.line);
	const column = Number(location.start.column);

	return {
		...(Number.isFinite(line) && line > 0 ? { line } : {}),
		...(Number.isFinite(column) && column > 0 ? { column } : {}),
	};
}

/** Read the JSON reporter's document, or undefined when this is not one. */
function readJson(text: string): ParsedOutput | undefined {
	const start = text.indexOf("{");
	if (start < 0) return undefined;

	let document: BiomeDocument;

	try {
		document = JSON.parse(text.slice(start)) as BiomeDocument;
	} catch {
		return undefined;
	}

	if (!isRecord(document) || !Array.isArray(document.diagnostics))
		return undefined;

	const failures: CheckFailure[] = [];

	for (const candidate of document.diagnostics) {
		if (!isRecord(candidate)) continue;

		const diagnostic = candidate as BiomeDiagnostic;
		const severity = diagnostic.severity === "warning" ? "warning" : "error";
		const message =
			typeof diagnostic.message === "string" ? diagnostic.message : "";
		const file = pathOf(diagnostic.location);

		failures.push({
			...(file === undefined ? {} : { file }),
			...positionOf(diagnostic.location),
			message,
			...(typeof diagnostic.category === "string" && diagnostic.category !== ""
				? { rule: diagnostic.category }
				: {}),
			severity,
		});
	}

	return { summary: count(failures, document.summary), failures };
}

/** Counts from the document's own summary, falling back to what was read. */
function count(
	failures: readonly CheckFailure[],
	summary: unknown,
): CheckSummary {
	const fromDiagnostics = {
		errors: failures.filter((failure) => failure.severity === "error").length,
		warnings: failures.filter((failure) => failure.severity === "warning")
			.length,
	};

	if (!isRecord(summary)) return { ...EMPTY_SUMMARY, ...fromDiagnostics };

	const errors = Number(summary.errors);
	const warnings = Number(summary.warnings);

	return {
		...EMPTY_SUMMARY,
		errors: Number.isFinite(errors) ? errors : fromDiagnostics.errors,
		warnings: Number.isFinite(warnings) ? warnings : fromDiagnostics.warnings,
	};
}

/** Read the pretty reporter: a header per diagnostic, marked below it. */
function readPretty(text: string): ParsedOutput {
	const lines = text.split(/\r?\n/u);
	const failures: CheckFailure[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const located = LOCATED.exec(line);
		const header = located ?? UNLOCATED.exec(line);

		if (header?.groups === undefined) continue;

		const marked = diagnosticBelow(lines, index + 1);
		const at = Number(located?.groups?.line);
		const column = Number(located?.groups?.column);

		failures.push({
			file: header.groups.file ?? "",
			...(Number.isFinite(at) ? { line: at } : {}),
			...(Number.isFinite(column) ? { column } : {}),
			rule: header.groups.category ?? "",
			message: marked.message,
			severity: marked.severity,
		});
	}

	return {
		summary: {
			...EMPTY_SUMMARY,
			errors: numberAfter(text, FOUND_ERRORS) ?? countOf(failures, "error"),
			warnings:
				numberAfter(text, FOUND_WARNINGS) ?? countOf(failures, "warning"),
		},
		failures,
	};
}

/** The severity and the wording of the diagnostic whose header is above `from`. */
function diagnosticBelow(
	lines: readonly string[],
	from: number,
): { severity: "error" | "warning"; message: string } {
	for (let index = from; index < lines.length; index += 1) {
		const line = lines[index] ?? "";

		if (LOCATED.test(line) || UNLOCATED.test(line)) break;

		const marker = MARKER.exec(line);

		if (marker !== null)
			return {
				severity: marker.groups?.marker === "!" ? "warning" : "error",
				message: line.replace(MARKER, "").trim(),
			};
	}

	return { severity: "error", message: "" };
}

function numberAfter(text: string, pattern: RegExp): number | undefined {
	const match = pattern.exec(text);
	const value = match?.[1] === undefined ? undefined : Number(match[1]);

	return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function countOf(
	failures: readonly CheckFailure[],
	severity: "error" | "warning",
): number {
	return failures.filter((failure) => failure.severity === severity).length;
}

export const parseBiome: Parser = (text) => readJson(text) ?? readPretty(text);

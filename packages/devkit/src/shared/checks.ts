/**
 * What one run of the project's checks looks like on both sides of the wire.
 *
 * The host half produces a {@link ChecksReport}, the tool's `presentationMeta`
 * carries it into the session log, and the browser half narrows it out again to
 * draw the card. The payload is opaque JSON on the wire, so both halves share
 * these types and the browser half validates before rendering.
 */

/** How a recipe's output is read. The project names one per recipe. */
export type ParserName =
	| "tsc"
	| "biome"
	| "eslint"
	| "vitest"
	| "jest"
	| "pytest"
	| "generic";

/** Every parser a recipe may name, in the order the documentation lists them. */
export const PARSER_NAMES: readonly ParserName[] = [
	"tsc",
	"biome",
	"eslint",
	"vitest",
	"jest",
	"pytest",
	"generic",
];

/** Whether a raw string names a parser this plugin has. */
export function isParserName(value: string): value is ParserName {
	return (PARSER_NAMES as readonly string[]).includes(value);
}

/** Counts one check reported. */
export interface CheckSummary {
	/** Diagnostics the tool called errors. */
	readonly errors: number;
	/** Diagnostics the tool called warnings. */
	readonly warnings: number;
	readonly testsPassed: number;
	readonly testsFailed: number;
	readonly testsSkipped: number;
}

/** No counts at all, which is all a parser knows when it only has the exit code. */
export const EMPTY_SUMMARY: CheckSummary = {
	errors: 0,
	warnings: 0,
	testsPassed: 0,
	testsFailed: 0,
	testsSkipped: 0,
};

/** One place a check complained about. */
export interface CheckFailure {
	/** The path the tool printed, relative to the project root when it printed one. */
	readonly file?: string;
	/** 1-based line, when the tool names one. */
	readonly line?: number;
	/** 1-based column, when the tool names one. */
	readonly column?: number;
	readonly message: string;
	/** The rule or error code, when the tool names one. */
	readonly rule?: string;
	readonly severity: "error" | "warning";
}

/** How one recipe ended. */
export type CheckStatus = "passed" | "failed" | "errored" | "timedout";

/** One recipe's run. */
export interface CheckResult {
	/** The recipe's name in the project's config, which is what the model asked for. */
	readonly name: string;
	/** The command line the project wrote for it. */
	readonly command: string;
	readonly parser: ParserName;
	readonly status: CheckStatus;
	readonly durationMs: number;
	/** Null when the command died from a signal or never started. */
	readonly exitCode: number | null;
	readonly summary: CheckSummary;
	readonly failures: readonly CheckFailure[];
	/** How many failures the run found, before the card's own cap. */
	readonly failureTotal?: number;
	/** The tail of what the command printed, kept for a check nothing parsed. */
	readonly output?: string;
}

/** One tool call's whole run, in recipe order. */
export interface ChecksReport {
	/** Whether every recipe passed. */
	readonly ok: boolean;
	readonly checks: readonly CheckResult[];
}

/** The card payload: one run plus the call that produced it. */
export interface ChecksCard extends ChecksReport {
	/** The tool call that produced it; the card's identity. */
	readonly callId: string;
}

/** How many failures one card draws; the rest are counted, not listed. */
export const MAX_CARD_FAILURES = 100;

/** How much output the card keeps for a check that no parser read. */
export const OUTPUT_TAIL_LINES = 40;

/** A count with its noun: `3 errors`, `1 error`. */
export function countLabel(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A duration as a person reads it: `840ms`, `2.3s`, `1m 04s`. */
export function durationLabel(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

	const seconds = Math.round(ms / 1000);

	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * Where a failure points, as a person reads it: `src/a.ts:12:5`.
 * @returns the label, or undefined for a failure that names no file.
 */
export function locationLabel(failure: CheckFailure): string | undefined {
	if (failure.file === undefined) return undefined;

	const position =
		failure.line === undefined
			? ""
			: `:${failure.line}${failure.column === undefined ? "" : `:${failure.column}`}`;

	return `${failure.file}${position}`;
}

/**
 * What one check reported, in as few words as its own counts allow.
 *
 * A test runner's counts are the most informative thing it produced, then a
 * linter's diagnostics, and only then the exit status — which is all a check
 * that nobody parses has to say.
 */
export function checkLabel(check: CheckResult): string {
	const { testsPassed, testsFailed, testsSkipped, errors, warnings } =
		check.summary;
	const tests = testsPassed + testsFailed + testsSkipped;

	if (tests > 0) {
		const parts = [`${testsPassed}/${tests} tests`];

		if (testsFailed > 0) parts.push(`${testsFailed} failed`);
		if (testsSkipped > 0) parts.push(`${testsSkipped} skipped`);

		return parts.join(" · ");
	}

	const diagnostics = [
		errors === 0 ? "" : countLabel(errors, "error"),
		warnings === 0 ? "" : countLabel(warnings, "warning"),
	].filter(Boolean);

	if (diagnostics.length > 0) return diagnostics.join(" · ");

	if (check.status === "timedout") return "timed out";
	if (check.status === "errored") return "could not run";
	if (check.status === "passed") return "passed";

	return check.exitCode === null ? "failed" : `exit ${check.exitCode}`;
}

/** Whether a value is a JSON object, which is all the wire promises. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: 0;
}

function asSummary(value: unknown): CheckSummary {
	if (!isRecord(value)) return EMPTY_SUMMARY;

	return {
		errors: asCount(value.errors),
		warnings: asCount(value.warnings),
		testsPassed: asCount(value.testsPassed),
		testsFailed: asCount(value.testsFailed),
		testsSkipped: asCount(value.testsSkipped),
	};
}

function asFailure(value: unknown): CheckFailure | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.message !== "string" || value.message === "")
		return undefined;

	const line = asCount(value.line);
	const column = asCount(value.column);

	return {
		...(typeof value.file === "string" && value.file !== ""
			? { file: value.file }
			: {}),
		...(line === 0 ? {} : { line }),
		...(column === 0 ? {} : { column }),
		message: value.message,
		...(typeof value.rule === "string" && value.rule !== ""
			? { rule: value.rule }
			: {}),
		severity: value.severity === "warning" ? "warning" : "error",
	};
}

function asStatus(value: unknown): CheckStatus {
	return value === "failed" ||
		value === "errored" ||
		value === "timedout" ||
		value === "passed"
		? value
		: "errored";
}

function asCheck(value: unknown): CheckResult | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.name !== "string" || value.name === "") return undefined;

	const failures: CheckFailure[] = [];
	if (Array.isArray(value.failures))
		for (const candidate of value.failures) {
			const failure = asFailure(candidate);
			if (failure !== undefined) failures.push(failure);
		}

	const parser =
		typeof value.parser === "string" && isParserName(value.parser)
			? value.parser
			: "generic";
	const exitCode = asCount(value.exitCode);

	return {
		name: value.name,
		command: typeof value.command === "string" ? value.command : "",
		parser,
		status: asStatus(value.status),
		durationMs: asCount(value.durationMs),
		exitCode: value.exitCode === null ? null : exitCode,
		summary: asSummary(value.summary),
		failures: failures.slice(0, MAX_CARD_FAILURES),
		...(asCount(value.failureTotal) > 0
			? { failureTotal: asCount(value.failureTotal) }
			: {}),
		...(typeof value.output === "string" && value.output !== ""
			? { output: value.output }
			: {}),
	};
}

/**
 * Validate one opaque payload.
 * @param value - the record's `data`, as delivered to the browser.
 * @returns the card, or undefined when the record is not one of ours or was
 *   written by a version whose payload this one cannot render. A card that
 *   cannot be validated renders nothing, which is why the tool's text result
 *   stays the source of truth for the model.
 */
export function asChecksCard(value: unknown): ChecksCard | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.callId !== "string" || value.callId === "") return undefined;
	if (!Array.isArray(value.checks)) return undefined;

	const checks: CheckResult[] = [];
	for (const candidate of value.checks) {
		const check = asCheck(candidate);
		if (check !== undefined) checks.push(check);
	}

	if (checks.length === 0) return undefined;

	return { callId: value.callId, ok: value.ok === true, checks };
}

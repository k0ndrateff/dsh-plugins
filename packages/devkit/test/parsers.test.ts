/**
 * Every parser against a recorded stream.
 *
 * Provenance matters here, so it is stated per fixture: the `tsc`, Biome and
 * pytest streams were captured from real runs on this machine, and the ESLint,
 * Vitest and Jest streams are written from those tools' documented default
 * output — neither is installed here, and inventing a run would prove nothing.
 * When one of them is next run for real, replace its fixture with the capture.
 *
 *   bun run test/parsers.ts
 */

import { expect, test } from "bun:test";
import { parserNamed } from "../src/host/parsers/index";
import { isParserName, PARSER_NAMES } from "../src/shared/checks";

/** Captured: `tsc --noEmit --strict` on a file with one type error. */
const TSC_ERRORS = [
	".scratch/broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
	".scratch/broken.ts(5,14): warning TS6133: 'unused' is declared but its value is never read.",
	"error TS5058: The specified path does not exist: 'nope.ts'.",
	"Found 2 errors in the same file.",
].join("\n");

/** Captured: `biome check --reporter=json`, with the reporter's own notice. */
const BIOME_JSON = [
	"The `json` and `json-pretty` reporters are experimental and may change in patch releases.",
	'{"summary":{"changed":0,"unchanged":2,"matches":0,"duration":2364250,"errors":0,"warnings":1,"infos":0,"skipped":0,"suggestedFixesSkipped":0,"diagnosticsNotPrinted":0,"scannerDuration":819208},"diagnostics":[{"severity":"warning","message":"This let declares a variable that is only assigned once.","category":"lint/style/useConst","location":{"path":".scratch/broken.ts","start":{"line":2,"column":1},"end":{"line":2,"column":4}},"advices":[]}],"command":"check"}',
].join("\n");

/** Captured: `biome check` on a file with two error-severity diagnostics. */
const BIOME_PRETTY_ERRORS = [
	".scratch/lint.ts:2:2 lint/suspicious/noDebugger  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"  × This is an unexpected use of the debugger statement.",
	"  ",
	"    1 │ export function compare(a: unknown, b: unknown): boolean {",
	"  > 2 │ \tdebugger;",
	"      │ \t^^^^^^^^^",
	"    3 │ \treturn a == b;",
	"",
	"  i Unsafe fix: Remove debugger statement",
	"",
	".scratch/lint.ts:3:11 lint/suspicious/noDoubleEquals  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"  × Using == may be unsafe if you are relying on type coercion.",
	"",
	"Checked 1 file in 2ms. No fixes applied.",
	"Found 2 errors.",
].join("\n");

/** Captured: `biome check` on a file with one warning-severity diagnostic. */
const BIOME_PRETTY_WARNING = [
	".scratch/broken.ts:2:1 lint/style/useConst  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"  ! This let declares a variable that is only assigned once.",
	"",
	"Checked 1 file in 190ms. No fixes applied.",
	"Found 1 warning.",
].join("\n");

/**
 * Captured: `biome check` on a file the formatter would rewrite. Its header
 * names no position, because the diagnostic is about the whole file.
 */
const BIOME_PRETTY_FORMAT = [
	".dsh-checks.json format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
	"",
	"  × Formatter would have printed the following content:",
	"  ",
	"     1  1 │   {",
	'     2    │ - ··"checks":·{',
	'        2 │ + → "checks":·{',
	"",
	"Checked 1 file in 12ms. No fixes applied.",
	"Found 1 error.",
].join("\n");

/** Documented: ESLint's default `stylish` formatter. */
const ESLINT_STYLISH = [
	"/Users/me/app/src/sum.js",
	"  12:5  error    'total' is assigned a value but never used  no-unused-vars",
	"  15:1  warning  Missing semicolon                           semi",
	"",
	"✖ 2 problems (1 error, 1 warning)",
	"  1 error and 0 warnings potentially fixable with the `--fix` option.",
].join("\n");

/** Documented: Vitest's default reporter for one file with one failing test. */
const VITEST_FAILED = [
	" ❯ test/sum.test.ts (2 tests | 1 failed) 21ms",
	"   × adds 1 + 2 to equal 3",
	"     → expected 3 to be 4 // Object.is equality",
	"",
	" Test Files  1 failed (1)",
	"      Tests  1 failed | 1 passed (2)",
	"   Start at  10:00:00",
	"   Duration  210ms",
].join("\n");

/** Documented: Jest's default reporter for one file with one failing test. */
const JEST_FAILED = [
	"FAIL src/sum.test.js",
	"  ● adds 1 + 2",
	"",
	"    expect(received).toBe(expected)",
	"",
	"    Expected: 4",
	"    Received: 3",
	"",
	"      3 | test('adds', () => {",
	"    > 4 |   expect(add(1, 2)).toBe(4)",
	"        |                   ^",
	"      5 | })",
	"",
	"      at Object.<anonymous> (src/sum.test.js:4:21)",
	"",
	"Test Suites: 1 failed, 1 total",
	"Tests:       1 failed, 2 passed, 3 total",
	"Snapshots:   0 total",
].join("\n");

/** Captured: `pytest` on a file with two failures, a pass, and a skip. */
const PYTEST_FAILED = [
	"F.sF                                                                     [100%]",
	"=================================== FAILURES ===================================",
	"___________________________________ test_add ___________________________________",
	"",
	"    def test_add():",
	">       assert add(1, 2) == 4",
	"E       assert 3 == 4",
	"E        +  where 3 = add(1, 2)",
	"",
	"tests/test_math.py:9: AssertionError",
	"_________________________________ test_raises __________________________________",
	"",
	"    def test_raises():",
	"        with pytest.raises(ValueError):",
	'>           raise KeyError("nope")',
	"E           KeyError: 'nope'",
	"",
	"tests/test_math.py:23: KeyError",
	"=========================== short test summary info ============================",
	"FAILED tests/test_math.py::test_add - assert 3 == 4",
	"FAILED tests/test_math.py::test_raises - KeyError: 'nope'",
	"2 failed, 1 passed, 1 skipped in 0.02s",
].join("\n");

test("tsc", async () => {
	{
		const parsed = parserNamed("tsc")(TSC_ERRORS);

		expect(
			parsed.summary.errors === 2 && parsed.summary.warnings === 1,
			`counts errors and warnings separately — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures.length === 3,
			"reads one failure per diagnostic",
		).toBe(true);
		expect(
			parsed.failures[0]?.file === ".scratch/broken.ts" &&
				parsed.failures[0]?.line === 1 &&
				parsed.failures[0]?.column === 7 &&
				parsed.failures[0]?.rule === "TS2322",
			`a located diagnostic carries file, line, column and code — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
		expect(
			parsed.failures[1]?.severity === "warning",
			"a warning keeps its severity",
		).toBe(true);
		expect(
			parsed.failures[2]?.file === undefined &&
				(parsed.failures[2]?.message ?? "").includes("nope.ts"),
			`a diagnostic with no file keeps its message — ${JSON.stringify(parsed.failures[2])}`,
		).toBe(true);
		expect(
			parsed.failures.every((failure) => !failure.message.startsWith("Found")),
			"the compiler's own summary line is not a diagnostic",
		).toBe(true);
	}
});
test("biome", async () => {
	{
		const parsed = parserNamed("biome")(BIOME_JSON);

		expect(
			parsed.summary.warnings === 1 && parsed.summary.errors === 0,
			`the JSON reporter's own summary is read — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures[0]?.file === ".scratch/broken.ts" &&
				parsed.failures[0]?.line === 2 &&
				parsed.failures[0]?.column === 1 &&
				parsed.failures[0]?.rule === "lint/style/useConst" &&
				(parsed.failures[0]?.message ?? "").startsWith("This let declares"),
			`its diagnostic carries path, position, rule and message — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);

		const errors = parserNamed("biome")(BIOME_PRETTY_ERRORS);

		expect(
			errors.summary.errors === 2,
			`the pretty reporter's errors are counted — ${JSON.stringify(errors.summary)}`,
		).toBe(true);
		expect(
			errors.failures.length === 2 &&
				errors.failures[0]?.rule === "lint/suspicious/noDebugger" &&
				(errors.failures[0]?.message ?? "").includes("debugger"),
			`each pretty header becomes a failure with its rule and wording — ${JSON.stringify(errors.failures[0])}`,
		).toBe(true);
		expect(
			errors.failures.every((failure) => failure.severity === "error") &&
				parserNamed("biome")(BIOME_PRETTY_WARNING).failures[0]?.severity ===
					"warning",
			`the × marker means error and the ! marker means warning — ${JSON.stringify(parserNamed("biome")(BIOME_PRETTY_WARNING).failures[0])}`,
		).toBe(true);
		expect(
			parserNamed("biome")(BIOME_PRETTY_WARNING).summary.warnings === 1,
			"a pretty run counts what its summary line says",
		).toBe(true);

		const formatted = parserNamed("biome")(BIOME_PRETTY_FORMAT);

		expect(
			formatted.failures.length === 1 &&
				formatted.failures[0]?.file === ".dsh-checks.json" &&
				formatted.failures[0]?.rule === "format" &&
				(formatted.failures[0]?.message ?? "").startsWith("Formatter would"),
			`a formatter diagnostic, whose header names no position, is still read — ${JSON.stringify(formatted.failures[0])}`,
		).toBe(true);
		expect(
			formatted.failures[0]?.line === undefined &&
				formatted.summary.errors === 1,
			`a formatter diagnostic keeps no line it does not have — ${JSON.stringify(formatted.summary)}`,
		).toBe(true);
	}
});
test("eslint", async () => {
	{
		const parsed = parserNamed("eslint")(ESLINT_STYLISH);

		expect(
			parsed.summary.errors === 1 && parsed.summary.warnings === 1,
			`counts one error and one warning — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures.length === 2 &&
				parsed.failures[0]?.file === "/Users/me/app/src/sum.js" &&
				parsed.failures[0]?.line === 12 &&
				parsed.failures[0]?.column === 5 &&
				parsed.failures[0]?.rule === "no-unused-vars",
			`each problem carries its file, position and rule — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
		expect(
			(parsed.failures[0]?.message ?? "") ===
				"'total' is assigned a value but never used",
			`the message keeps its own words — ${parsed.failures[0]?.message}`,
		).toBe(true);
		expect(
			parsed.failures.every((failure) => failure.rule !== "option."),
			"the summary line is not read as a problem",
		).toBe(true);
	}
});
test("vitest", async () => {
	{
		const parsed = parserNamed("vitest")(VITEST_FAILED);

		expect(
			parsed.summary.testsPassed === 1 && parsed.summary.testsFailed === 1,
			`counts the tests the summary line names — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures[0]?.file === "test/sum.test.ts",
			`the failing test carries its file — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
		expect(
			(parsed.failures[0]?.message ?? "").includes("expected 3 to be 4"),
			`the assertion under it becomes the message — ${parsed.failures[0]?.message}`,
		).toBe(true);
	}
});
test("jest", async () => {
	{
		const parsed = parserNamed("jest")(JEST_FAILED);

		expect(
			parsed.summary.testsPassed === 2 && parsed.summary.testsFailed === 1,
			`counts the tests the summary line names — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures[0]?.file === "src/sum.test.js" &&
				parsed.failures[0]?.message === "adds 1 + 2",
			`the failing test carries its file and name — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
	}
});
test("pytest", async () => {
	{
		const parsed = parserNamed("pytest")(PYTEST_FAILED);

		expect(
			parsed.summary.testsFailed === 2 &&
				parsed.summary.testsPassed === 1 &&
				parsed.summary.testsSkipped === 1,
			`counts failures, passes and skips — ${JSON.stringify(parsed.summary)}`,
		).toBe(true);
		expect(
			parsed.failures.length === 2 &&
				parsed.failures[0]?.message === "test_add — assert 3 == 4",
			`the short summary names both failures — ${JSON.stringify(parsed.failures[0])}`,
		).toBe(true);
		expect(
			parsed.failures[0]?.line === 9 && parsed.failures[1]?.line === 23,
			`each failure gets the line of its own traceback frame — ${`${parsed.failures[0]?.line}, ${parsed.failures[1]?.line}`}`,
		).toBe(true);
		expect(
			parsed.failures.every((failure) => failure.file === "tests/test_math.py"),
			"a failing test names its file",
		).toBe(true);
	}
});
test("generic and the registry", async () => {
	{
		const parsed = parserNamed("generic")("anything at all\n");

		expect(
			parsed.failures.length === 0 &&
				Object.values(parsed.summary).every((count) => count === 0),
			"the fallback reads no counts and no failures",
		).toBe(true);
		expect(
			PARSER_NAMES.every((name) => typeof parserNamed(name) === "function"),
			"every name in the vocabulary has a parser",
		).toBe(true);
		expect(
			!isParserName("mocha"),
			"a name outside the vocabulary is refused",
		).toBe(true);
	}
});

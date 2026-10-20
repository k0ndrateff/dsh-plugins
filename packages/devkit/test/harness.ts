/**
 * The tally the offline suites share.
 *
 * Each suite is its own script so a failure names the file that failed; this
 * only counts, prints, and decides the exit code.
 */

let failures = 0;
let checks = 0;

/** Record one expectation. */
export function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** Print a section heading. */
export function section(title: string): void {
	console.log(`\n=== ${title} ===`);
}

/** Print the tally and exit: non-zero when anything failed. */
export function report(): void {
	console.log(`\n${checks - failures}/${checks} checks passed`);

	process.exit(failures > 0 ? 1 : 0);
}

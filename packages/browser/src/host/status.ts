/**
 * Whether the browser can run here at all.
 *
 * `doctor --json` is the CLI's own answer about the machine: the executable, its
 * version, Chrome, the socket directory, the daemon. It answers with a list of
 * checks rather than the command envelope, so it is read by its own parser — and
 * every check is carried further with its id already turned into words, because
 * "chrome.installed: no Chrome found" is a debug line and "Chrome: no Chrome
 * found" is a sentence a person can act on.
 */

import { type DoctorCheckView, doctorLabelOf } from "../shared/doctor";

/** One check in the CLI's own report. */
export interface DoctorCheck {
	readonly id: string;
	readonly category: string;
	readonly message: string;
	readonly status: string;
}

/** The report, as far as this plugin reads it. */
export interface DoctorReport {
	readonly checks: readonly DoctorCheck[];
}

/** What a caller needs to know before blaming its own arguments. */
export interface BrowserStatus {
	/** The CLI's version line, when the report carried one. */
	readonly version: string | undefined;
	/** The Chrome the CLI found, when it found one. */
	readonly chrome: string | undefined;
	/** Every check, named for a person to read. */
	readonly checks: readonly DoctorCheckView[];
}

/** Whether one entry of the report is a check. */
const isCheck = (value: unknown): value is DoctorCheck => {
	if (value === null || typeof value !== "object") return false;

	const record = value as Record<string, unknown>;

	return (
		typeof record.id === "string" &&
		typeof record.category === "string" &&
		typeof record.message === "string" &&
		typeof record.status === "string"
	);
};

/**
 * Read `doctor --json`.
 * @param stdout - everything the command wrote to stdout.
 * @returns the report, or undefined when the answer was not one.
 */
export const parseDoctor = (stdout: string): DoctorReport | undefined => {
	const text = stdout.trim();
	if (text === "") return undefined;

	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}

	if (parsed === null || typeof parsed !== "object") return undefined;

	const checks = (parsed as { checks?: unknown }).checks;

	return Array.isArray(checks) && checks.every(isCheck)
		? { checks: checks as readonly DoctorCheck[] }
		: undefined;
};

/**
 * One check's message, by its id, and only when the check passed.
 *
 * A failing `chrome.installed` carries the reason Chrome is missing, not a
 * Chrome: reading it as the found browser would print "Chrome: no Chrome found".
 * The failure itself is already carried in {@link BrowserStatus.checks}.
 */
const messageOf = (report: DoctorReport, id: string): string | undefined =>
	report.checks.find((check) => check.id === id && check.status === "pass")
		?.message;

/**
 * What a reader should be told about this machine.
 * @param report - the CLI's own report.
 */
export const summarizeDoctor = (report: DoctorReport): BrowserStatus => {
	const version = messageOf(report, "env.version");
	const chrome = messageOf(report, "chrome.installed");

	return {
		version:
			version === undefined ? undefined : version.replace(/^CLI version /u, ""),
		chrome,
		checks: report.checks.map((check) => ({
			id: check.id,
			label: doctorLabelOf(check.id),
			status: check.status,
			message: check.message,
		})),
	};
};

/** The checks that failed, as one line each, without repeating the raw id. */
export const failingChecks = (
	status: BrowserStatus,
): readonly DoctorCheckView[] =>
	status.checks.filter((check) => check.status === "fail");

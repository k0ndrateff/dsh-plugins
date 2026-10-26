/**
 * The CLI's own checks, named the way a person reads them.
 *
 * `doctor --json` names a check by an id such as `chrome.installed` — exactly
 * right for code and exactly wrong for the sentence a person needs when Chrome
 * is missing. Both halves show the same report: the command in the chat, and the
 * settings page. So the dictionary lives here, where the two bundles can each
 * inline the same copy.
 */

/** The words this plugin puts next to the ids `doctor` reports. */
const LABELS: Readonly<Record<string, string>> = {
	"env.version": "CLI version",
	"env.home": "Home directory",
	"env.state_dir": "State directory",
	"env.socket_dir": "Socket directory",
	"env.disk_free": "Free disk space",
	"chrome.installed": "Chrome",
	"chrome.user_data_dir": "Chrome profile data",
	"security.encryption_key": "Encryption key",
	"security.state_count": "Saved browser states",
	"net.chrome_cdn": "Chrome download reachable",
	"launch.launch": "Browser launch",
	"doctor.unreadable": "Doctor report",
};

/** The one provider-ish family whose ids name the provider itself. */
const PROVIDER_PREFIX = "providers.";

/**
 * A check's name, as a person reads it.
 *
 * A provider check is "Browserless" rather than "providers.browserless", and an
 * id this version has never met is still turned into words instead of being
 * printed raw — the answer is a report about the machine, not a debug dump.
 * @param id - the check's id from `doctor --json`.
 */
export const doctorLabelOf = (id: string): string => {
	if (id === "daemon" || id.startsWith("daemon.")) return "Browser daemon";

	if (id.startsWith(PROVIDER_PREFIX)) {
		const rest = id.slice(PROVIDER_PREFIX.length).replace(/_/gu, " ");

		return `${rest.charAt(0).toUpperCase()}${rest.slice(1)} provider`;
	}

	const known = LABELS[id];

	if (known !== undefined) return known;

	const words = id
		.replace(/[._]/gu, " ")
		.trim()
		.replace(/\b\w/gu, (letter) => letter.toUpperCase());

	return words === "" ? "Check" : words;
};

/** One check of the report, as both readers show it. */
export interface DoctorCheckView {
	readonly id: string;
	/** The check's name in a person's words. */
	readonly label: string;
	/** `pass`, `fail`, `warn`, or anything else the CLI invents. */
	readonly status: string;
	/** The CLI's own sentence about this check. */
	readonly message: string;
}

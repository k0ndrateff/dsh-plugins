/**
 * The Sentry settings section.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 * The card itself belongs to `dsh-integration-ui`; what is Sentry's is its copy
 * and the organization it works with.
 */

import { createSettingsSection } from "dsh-integration-ui";
import type { ReactNode } from "react";
import type { SentryStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** The account row Sentry adds under the card's blurb. */
const details = (status: SentryStatus): ReactNode => {
	if (status.organization === null) return null;

	return (
		<div className={styles.row}>
			<span className={styles.caption}>
				{`Organization: ${status.organization}`}
			</span>

			{status.organizationUrl === null ? null : (
				<a
					className={styles.link}
					href={status.organizationUrl}
					target="_blank"
					rel="noreferrer"
				>
					Open in Sentry
				</a>
			)}
		</div>
	);
};

/** The Sentry settings card. */
export const SentrySection = createSettingsSection<SentryStatus>({
	title: "Sentry",
	blurb: "Errors and performance issues, through Sentry’s MCP server.",
	checking: "Checking the Sentry sign-in…",
	unreachable: "The Sentry host half is not reachable.",
	signInLabel: "Sign in with Sentry",
	syncLabel: "Sync",
	api: hostApi,
	details,
});

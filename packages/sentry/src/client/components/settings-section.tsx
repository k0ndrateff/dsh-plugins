/**
 * The Sentry settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 * The card itself belongs to `dsh-integration-ui`; what is Sentry's is its copy,
 * the organization it works with, and the tab it sits under.
 */

import { createSettingsSection, type FactItem } from "dsh-integration-ui";
import { isWebUrl } from "../../shared/link";
import type { SentryStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** The organization Sentry works with, and the way to it. */
const details = (status: SentryStatus): readonly FactItem[] => [
	{
		label: "Organization",
		value:
			status.organization === null ? undefined : (
				<>
					{status.organization}

					{!isWebUrl(status.organizationUrl) ? null : (
						<>
							{" · "}

							<a
								className={styles.link}
								href={status.organizationUrl}
								target="_blank"
								rel="noreferrer"
							>
								Open in Sentry
							</a>
						</>
					)}
				</>
			),
	},
];

/** The Sentry settings card. */
export const SentrySection = createSettingsSection<SentryStatus>({
	title: "Sentry",
	blurb: "Errors and performance issues, through Sentry’s MCP server.",
	checking: "Checking the Sentry sign-in…",
	unreachable: "The Sentry host half is not reachable.",
	credentials: "browser",
	signInLabel: "Sign in with Sentry",
	syncLabel: "Re-check",
	api: hostApi,
	details,
});

/**
 * The GitLab settings card.
 *
 * It is the only place a user has to go to connect, and connecting here means
 * pasting a personal access token: GitLab's MCP server issues tokens that only
 * work at the MCP endpoint, and that endpoint is switched off per group, so the
 * token the user already has is what this integration asks for. The card itself
 * belongs to `dsh-integration-ui`, which owns the field, the save, and the
 * failure it shows; what is GitLab's is its copy, the account it works with, and
 * the tab it sits under.
 *
 * Once a token is stored the field is gone: replacing a working credential is a
 * deliberate act, so the card offers it as one button rather than leaving a box
 * open beside the account.
 */

import { createSettingsSection, type FactItem } from "dsh-integration-ui";
import type { GitLabStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** The account the stored token belongs to, and the way to it. */
const details = (status: GitLabStatus): readonly FactItem[] => [
	{
		label: "Account",
		value:
			status.username === null ? undefined : (
				<>
					{status.username}

					{status.userUrl === null ? null : (
						<>
							{" · "}

							<a
								className={styles.link}
								href={status.userUrl}
								target="_blank"
								rel="noreferrer"
							>
								Open in GitLab
							</a>
						</>
					)}
				</>
			),
	},
];

/** The GitLab settings card. */
export const GitLabSection = createSettingsSection<GitLabStatus>({
	title: "GitLab",
	blurb:
		"Merge requests, review threads and pipelines, through GitLab’s REST API.",
	checking: "Checking the GitLab token…",
	unreachable: "The GitLab host half is not reachable.",
	credentials: "typed",
	syncLabel: "Check the token",
	api: hostApi,
	token: {
		label: "Personal access token",
		placeholder: "glpat-…",
		hint:
			"Create one with the api scope in GitLab → Preferences → Access tokens, " +
			"and paste it here. It is kept in the harness credential store.",
		saveLabel: "Save token",
		replaceLabel: "Replace token",
		clearLabel: "Forget token",
		save: hostApi.saveToken,
	},
	details,
});

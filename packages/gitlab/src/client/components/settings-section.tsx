/**
 * The GitLab settings section.
 *
 * It is the only place a user has to go to connect, and connecting here means
 * pasting a personal access token: GitLab's MCP server issues tokens that only
 * work at the MCP endpoint, and that endpoint is switched off per group, so the
 * token the user already has is what this integration asks for. The card itself
 * belongs to `dsh-integration-ui`, which owns the field, the save, and the
 * failure it shows; what is GitLab's is its copy and the account it works with.
 */

import { createSettingsSection } from "dsh-integration-ui";
import type { ReactNode } from "react";
import type { GitLabStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** The account row GitLab adds under the card's blurb. */
const details = (status: GitLabStatus): ReactNode => {
	if (status.username === null) return null;

	return (
		<div className={styles.row}>
			<span className={styles.caption}>{`Account: ${status.username}`}</span>

			{status.userUrl === null ? null : (
				<a
					className={styles.link}
					href={status.userUrl}
					target="_blank"
					rel="noreferrer"
				>
					Open in GitLab
				</a>
			)}
		</div>
	);
};

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
		clearLabel: "Forget token",
		save: hostApi.saveToken,
	},
	details,
});

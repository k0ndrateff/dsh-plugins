/**
 * The Atlassian settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 * An account that reaches several sites chooses the default here, without
 * signing out: the choice is remembered beside the tokens in the host.
 *
 * The card itself belongs to `dsh-integration-ui`; what is Atlassian's is its
 * copy, the site it works with, and the tab it sits under.
 */

import { createSettingsSection, type FactItem } from "dsh-integration-ui";
import { useState } from "react";
import type { AtlassianSiteRef, AtlassianStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** A web address, which is the only shape of link worth rendering. */
const isWebUrl = (value: string | null | undefined): value is string =>
	typeof value === "string" && /^https?:\/\//u.test(value);

/**
 * The site Atlassian works with, and — on a multi-site account — the way to
 * change it.
 *
 * The row owns the selection so switching a site updates the link beside it
 * immediately; the host remembers the choice for the next start.
 */
const SiteChoice = ({ status }: { status: AtlassianStatus }) => {
	const [selected, setSelected] = useState(
		status.cloudId ?? status.sites[0]?.cloudId ?? "",
	);
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const site =
		status.sites.find((candidate) => candidate.cloudId === selected) ??
		status.sites[0];
	const url = site?.url ?? status.siteUrl;

	const choose = (next: AtlassianSiteRef): void => {
		setSelected(next.cloudId);
		setSaving(true);
		setFailure(null);

		hostApi
			.selectSite(next.cloudId)
			.then((answer) => {
				if (answer.cloudId !== null) setSelected(answer.cloudId);
			})
			.catch((error: unknown) => {
				setSelected(status.cloudId ?? "");
				setFailure(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				setSaving(false);
			});
	};

	return (
		<span className={styles.siteChoice}>
			{url === undefined ? null : (
				<>
					{url}

					{!isWebUrl(url) ? null : (
						<>
							{" · "}

							<a
								className={styles.link}
								href={url}
								target="_blank"
								rel="noreferrer"
							>
								Open in Atlassian
							</a>
						</>
					)}
				</>
			)}

			{status.sites.length < 2 ? null : (
				<>
					{" · "}

					<select
						className={styles.siteSelect}
						aria-label="Default Atlassian site"
						value={selected}
						disabled={saving}
						onChange={(event) => {
							const next = status.sites.find(
								(candidate) => candidate.cloudId === event.target.value,
							);

							if (next !== undefined) choose(next);
						}}
					>
						{status.sites.map((candidate) => (
							<option key={candidate.cloudId} value={candidate.cloudId}>
								{candidate.url}
							</option>
						))}
					</select>

					<span className={styles.caption}>
						{saving
							? "Saving…"
							: "Cards use this site unless one names another."}
					</span>
				</>
			)}

			{failure === null ? null : (
				<span className={styles.caption}>Could not switch: {failure}</span>
			)}
		</span>
	);
};

/** The site Atlassian works with, and the way to it. */
const details = (status: AtlassianStatus): readonly FactItem[] => [
	{
		label: "Site",
		value:
			status.siteUrl === null && status.sites.length === 0 ? undefined : (
				<SiteChoice status={status} />
			),
	},
];

/** The Atlassian settings card. */
export const AtlassianSection = createSettingsSection<AtlassianStatus>({
	title: "Atlassian",
	blurb:
		"Jira and Confluence, through Atlassian’s MCP server. Result cards summarize each item’s description with one extra model call.",
	checking: "Checking the Atlassian sign-in…",
	unreachable:
		"The Atlassian connection is not available yet. Try again in a moment.",
	credentials: "browser",
	signInLabel: "Sign in with Atlassian",
	syncLabel: "Re-check",
	details,
	api: hostApi,
});

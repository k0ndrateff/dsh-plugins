/**
 * The Sentry settings card.
 *
 * It shows the sign-in state and the connection state, and it is the only place
 * a user has to go to connect: the button starts the OAuth flow in the host,
 * which opens the browser, and this card follows the attempt until it settles.
 * An account that belongs to several organizations chooses the default here,
 * without signing out: the choice is remembered beside the tokens in the host.
 *
 * The card itself belongs to `dsh-integration-ui`; what is Sentry's is its copy,
 * the organization it works with, and the tab it sits under.
 */

import { createSettingsSection, type FactItem } from "dsh-integration-ui";
import { useState } from "react";
import { isWebUrl } from "../../shared/link";
import type { SentryOrganizationRef, SentryStatus } from "../../shared/status";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/**
 * The organization Sentry works with, and — on a multi-organization account —
 * the way to change it.
 *
 * The row owns the selection so switching updates the link beside it
 * immediately; the host remembers the choice for the next start.
 */
const OrganizationChoice = ({ status }: { status: SentryStatus }) => {
	const [selected, setSelected] = useState(
		status.organization ?? status.organizations[0]?.slug ?? "",
	);
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const organization =
		status.organizations.find((candidate) => candidate.slug === selected) ??
		status.organizations[0];
	const url = organization?.webUrl ?? status.organizationUrl ?? undefined;

	const choose = (next: SentryOrganizationRef): void => {
		setSelected(next.slug);
		setSaving(true);
		setFailure(null);

		hostApi
			.selectOrganization(next.slug)
			.then((answer) => {
				if (answer.organization !== null) setSelected(answer.organization);
			})
			.catch((error: unknown) => {
				setSelected(status.organization ?? "");
				setFailure(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				setSaving(false);
			});
	};

	return (
		<span className={styles.orgChoice}>
			{organization === undefined ? null : organization.slug}

			{!isWebUrl(url) ? null : (
				<>
					{" · "}

					<a
						className={styles.link}
						href={url}
						target="_blank"
						rel="noreferrer"
					>
						Open in Sentry
					</a>
				</>
			)}

			{status.organizations.length < 2 ? null : (
				<>
					{" · "}

					<select
						className={styles.orgSelect}
						aria-label="Default Sentry organization"
						value={selected}
						disabled={saving}
						onChange={(event) => {
							const next = status.organizations.find(
								(candidate) => candidate.slug === event.target.value,
							);

							if (next !== undefined) choose(next);
						}}
					>
						{status.organizations.map((candidate) => (
							<option key={candidate.slug} value={candidate.slug}>
								{candidate.slug}
							</option>
						))}
					</select>

					<span className={styles.caption}>
						{saving
							? "Saving…"
							: "Cards and the panel read this organization unless a card names another."}
					</span>
				</>
			)}

			{failure === null ? null : (
				<span className={styles.caption}>Could not switch: {failure}</span>
			)}
		</span>
	);
};

/** The organization Sentry works with, and the way to it. */
const details = (status: SentryStatus): readonly FactItem[] => [
	{
		label: "Organization",
		value:
			status.organization === null &&
			status.organizations.length === 0 ? undefined : (
				<OrganizationChoice status={status} />
			),
	},
];

/** The Sentry settings card. */
export const SentrySection = createSettingsSection<SentryStatus>({
	title: "Sentry",
	blurb: "Errors and performance issues, through Sentry’s MCP server.",
	checking: "Checking the Sentry sign-in…",
	unreachable:
		"The Sentry connection is not available yet. Try again in a moment.",
	credentials: "browser",
	signInLabel: "Sign in with Sentry",
	syncLabel: "Re-check",
	api: hostApi,
	details,
});

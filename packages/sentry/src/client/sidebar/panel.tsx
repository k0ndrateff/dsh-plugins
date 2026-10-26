/**
 * The Sentry panel: one issue, and the actions that change it.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to show arrives in the
 * tab's navigation parameters, the issue itself comes through the host's
 * `/dsh-sentry` route — only the host half holds the MCP connection — and the
 * loading, failing, retrying and writing belong to `dsh-integration-ui`.
 *
 * Writes are one step at a time: run it, and the host answers with the issue as
 * it now stands, so the panel never renders an assumption about what a change
 * did. Only the actions that apply to the issue's current status are offered,
 * each says what it is doing, and the panel says what changed afterwards.
 *
 * The panel opens on the organization the card was read from, not on whatever
 * default the settings happen to hold: an issue id is only unique inside one
 * organization.
 */

import {
	Button,
	Input,
	Menu,
	type MenuEntry,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
	createPanelBody,
	createPanelTitle,
	Facts,
	type PanelActions,
	type PanelProvider,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isWebUrl } from "../../shared/link";
import {
	asIssuePanel,
	type CodeLocation,
	type IssueDetail,
	type IssuePanel,
	type IssueTag,
} from "../../shared/meta";
import { SuspectRow } from "../components/suspect-row";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";
import { asPanelTarget, type PanelTarget } from "./definition";
import {
	applicableStatusActions,
	type IssueStatusAction,
	STATUS_ACTION_LABELS,
	statusText,
} from "./status-actions";
import { type PanelWriter, usePanelWriter } from "./write";

/** One moment as the reader's own locale and time zone write it. */
function whenText(value: string): string {
	const time = Date.parse(value);

	return Number.isNaN(time)
		? value
		: new Date(time).toLocaleString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				timeZoneName: "short",
			});
}

/** Where in the code the error was raised, as one line. */
function locationText(code: CodeLocation): string {
	const file = [code.repository, code.path]
		.filter((part) => part !== undefined && part !== "")
		.join("/");

	if (file === "") return "unknown";
	if (code.line === undefined) return file;

	return `${file}:${code.line}`;
}

/** One titled block; the title is a heading so the panel can be navigated by them. */
const Section = ({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) => (
	<section className={styles.panelSection}>
		<h3 className={`${styles.panelSectionTitle} ${styles.sectionHeading}`}>
			{title}
		</h3>
		{children}
	</section>
);

interface Actions {
	readonly busy: boolean;
	run: PanelActions<PanelTarget>["run"];
}

/** One status change the panel offers right now, with its call and its receipt. */
interface StatusAction {
	readonly id: IssueStatusAction;
	readonly label: string;
	/** What the panel says once the server confirmed it. */
	readonly changed: string;
	write(target: PanelTarget): Promise<unknown>;
}

/** The write behind each status change, and the sentence it leaves behind. */
const STATUS_WRITES: Readonly<
	Record<
		IssueStatusAction,
		{ readonly changed: string; write(target: PanelTarget): Promise<unknown> }
	>
> = {
	resolve: {
		changed: "Resolved. Sentry now shows this issue as resolved.",
		write: (target) =>
			hostApi.setStatus(target.id, "resolved", undefined, target.organization),
	},
	ignore: {
		changed:
			"Ignored until it escalates. Sentry will reopen it if it escalates.",
		write: (target) =>
			hostApi.setStatus(
				target.id,
				"ignored",
				"untilEscalating",
				target.organization,
			),
	},
	reopen: {
		changed: "Reopened. Sentry now shows this issue as unresolved.",
		write: (target) =>
			hostApi.setStatus(
				target.id,
				"unresolved",
				undefined,
				target.organization,
			),
	},
};

/** The status the issue is in, and the actions that apply to it. */
const StatusSection = ({
	issue,
	actions,
	writer,
}: {
	issue: IssueDetail;
	actions: Actions;
	writer: PanelWriter;
}) => {
	const offered: readonly StatusAction[] = applicableStatusActions(
		issue.status,
	).map((id) => ({
		id,
		label: STATUS_ACTION_LABELS[id],
		...STATUS_WRITES[id],
	}));

	return (
		<Section title="Status">
			<span className={styles.caption}>
				{`Sentry shows this issue as ${statusText(issue.status) ?? "unknown"}.`}
			</span>

			<div className={styles.actions}>
				{offered.map((action) => (
					<Button
						key={action.id}
						size="sm"
						variant="outline"
						disabled={actions.busy}
						onClick={() => {
							writer.run(action.id, action.changed, action.write);
						}}
					>
						{writer.pending === action.id ? `${action.label}…` : action.label}
					</Button>
				))}
			</div>

			<span className={styles.caption}>
				An ignored issue is reopened by Sentry when it escalates again.
			</span>
		</Section>
	);
};

/** References used in this page's session, so the second assignment is one click. */
const remembered: string[] = [];

/** How many remembered references the menu offers. */
const REMEMBERED_LIMIT = 4;

/** A stored Sentry reference, as a person reads it in the menu. */
const assigneeLabel = (reference: string): string => {
	if (reference.startsWith("user:")) return `User ${reference.slice(5)}`;
	if (reference.startsWith("team:")) return `Team ${reference.slice(5)}`;

	return reference;
};

/** Remember one reference, most recent first. */
function remember(reference: string): void {
	if (remembered.includes(reference)) return;

	remembered.unshift(reference);
	remembered.length = Math.min(remembered.length, REMEMBERED_LIMIT);
}

/** The members page that shows the id a `user:` reference needs. */
const membersUrl = (organizationUrl: string | undefined): string | undefined =>
	isWebUrl(organizationUrl)
		? `${organizationUrl.replace(/\/+$/u, "")}/settings/members/`
		: undefined;

/**
 * Hand the issue to somebody.
 *
 * Sentry's reference format is the field's whole contract and the MCP server
 * offers no member directory, so there is no list to pick from — but nobody
 * should have to type the same reference twice. The name that stands for the
 * reader is one call and one click, the references used in this session are
 * remembered, and the field itself appears only when a new person has to be
 * named by hand; it then says where the numeric id comes from.
 */
const Assignee = ({
	issue,
	actions,
	writer,
	organizationUrl,
}: {
	issue: IssueDetail;
	actions: Actions;
	writer: PanelWriter;
	organizationUrl: string | undefined;
}) => {
	const [open, setOpen] = useState(false);
	const [manual, setManual] = useState(false);
	const [value, setValue] = useState("");
	const [mine, setMine] = useState<string | null>(null);
	const [known, setKnown] = useState<readonly string[]>(remembered);

	// Who the reader is, asked once: without it the panel offers no self-assignment
	// rather than a reference Sentry would refuse.
	useEffect(() => {
		let live = true;

		hostApi
			.me()
			.then((reference) => {
				if (live) setMine(reference);
			})
			.catch(() => undefined);

		return () => {
			live = false;
		};
	}, []);

	const reference = value.trim();
	const members = membersUrl(organizationUrl);

	const assign = (assignedTo: string | null): void => {
		if (assignedTo !== null) {
			remember(assignedTo);
			setKnown([...remembered]);
		}

		setValue("");
		setManual(false);
		writer.run(
			assignedTo === null ? "unassign" : "assign",
			assignedTo === null
				? "Unassigned."
				: `Assigned to ${assigneeLabel(assignedTo)}.`,
			(target) => hostApi.assign(target.id, assignedTo, target.organization),
		);
	};

	const entries: MenuEntry[] = [
		...(mine === null ? [] : [{ id: "me", label: "Assign to me" }]),
		...known
			.filter((entry) => entry !== mine)
			.map((entry) => ({ id: entry, label: assigneeLabel(entry) })),
		{ id: "manual", label: "Assign by reference…" },
	];

	return (
		<Section title="Assignee">
			<div className={styles.row}>
				<span className={styles.caption}>
					{issue.assignee ?? "Nobody is assigned."}
				</span>

				<Menu
					open={open}
					onClose={() => {
						setOpen(false);
					}}
					autoFocus
					dense
					items={entries}
					onSelect={(id) => {
						setOpen(false);

						if (id === "me") {
							assign(mine);
							return;
						}

						// The footer's own row: the issue goes back to nobody.
						if (id === "unassign") {
							assign(null);
							return;
						}

						if (id === "manual") {
							setManual(true);
							return;
						}

						assign(id);
					}}
					footer={
						issue.assignee === undefined
							? []
							: [
									{
										id: "unassign",
										label: "Unassign",
										danger: true,
									},
								]
					}
					anchor={
						<Button
							size="sm"
							variant="ghost"
							disabled={actions.busy}
							onClick={() => {
								setOpen(!open);
							}}
						>
							{writer.pending === "assign" ? "Assigning…" : "Change"}
						</Button>
					}
				/>
			</div>

			{manual ? (
				<>
					<div className={styles.actions}>
						<Input
							className={styles.assignField}
							value={value}
							placeholder="user:123456 or team:backend"
							aria-label="Assignee reference, for example user:123456"
							disabled={actions.busy}
							onChange={(event) => {
								setValue(event.target.value);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" && reference !== "")
									assign(reference);
							}}
						/>

						<Button
							size="sm"
							variant="outline"
							disabled={actions.busy || reference === ""}
							onClick={() => {
								assign(reference);
							}}
						>
							Assign
						</Button>

						<Button
							size="sm"
							variant="ghost"
							disabled={actions.busy}
							onClick={() => {
								setValue("");
								setManual(false);
							}}
						>
							Cancel
						</Button>
					</div>

					<span className={styles.caption}>
						A user reference is Sentry’s numeric member id: user:&lt;id&gt;. A
						team reference is a slug: team:&lt;slug&gt;.
					</span>

					{members === undefined ? null : (
						<a
							className={styles.link}
							href={members}
							target="_blank"
							rel="noreferrer"
						>
							Where to find a member id
						</a>
					)}
				</>
			) : null}
		</Section>
	);
};

/** Where the error was raised, linked when Sentry named a URL. */
const Location = ({ code }: { code: CodeLocation }) => (
	<Section title="Location">
		{!isWebUrl(code.url) ? (
			<code className={styles.mono}>{locationText(code)}</code>
		) : (
			<a
				className={styles.link}
				href={code.url}
				target="_blank"
				rel="noreferrer"
			>
				{locationText(code)}
			</a>
		)}
	</Section>
);

/** The exception line, and the trace under it. */
const ErrorBlock = ({ issue }: { issue: IssueDetail }) => {
	if (issue.message === undefined && issue.stacktrace === undefined)
		return null;

	return (
		<Section title="Error">
			{issue.message === undefined ? null : (
				<p className={styles.message}>{issue.message}</p>
			)}

			{issue.stacktrace === undefined ? null : (
				<pre className={styles.stack}>{issue.stacktrace}</pre>
			)}
		</Section>
	);
};

/** The event's tags, in the order Sentry printed them. */
const Tags = ({ tags }: { tags: readonly IssueTag[] }) => {
	if (tags.length === 0) return null;

	return (
		<Section title={`Tags (${tags.length})`}>
			<ul className={styles.tags}>
				{tags.map((tag, index) => (
					<li key={`${tag.name}-${index}`} className={styles.tag}>
						<span className={styles.tagName}>{tag.name}</span>
						<span className={styles.tagValue}>{tag.value}</span>
					</li>
				))}
			</ul>
		</Section>
	);
};

/** One issue: what it is, how it is doing, and what may be done to it. */
const IssueView = ({
	panel,
	actions,
}: {
	panel: IssuePanel;
	actions: Actions;
}) => {
	const issue = panel.issue;
	const writer = usePanelWriter(
		actions,
		`${panel.organization ?? ""}:${issue.id}`,
	);
	// The status the document was read with is what the offered actions and the
	// labels are chosen from; it must be the one the buttons act on.
	const shownStatus = issue.status;

	return (
		<>
			<header className={styles.panelHead}>
				<div className={styles.panelTitleRow}>
					<span className={styles.panelKey}>{issue.id}</span>

					{!isWebUrl(issue.url) ? null : (
						<a
							className={styles.link}
							href={issue.url}
							target="_blank"
							rel="noreferrer"
						>
							Open in Sentry
						</a>
					)}
				</div>

				<h2 className={styles.panelSummary}>{issue.description ?? issue.id}</h2>

				<Facts
					items={[
						{
							label: "Status",
							value: statusText(shownStatus),
						},
						{ label: "Substatus", value: issue.substatus },
						{
							label: "Organization",
							value:
								panel.organization === null ? undefined : (
									<>
										{panel.organization}

										{!isWebUrl(panel.organizationUrl) ? null : (
											<>
												{" · "}

												<a
													className={styles.link}
													href={panel.organizationUrl}
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
						{ label: "Project", value: issue.project },
						{ label: "Platform", value: issue.platform },
						{ label: "Occurrences", value: issue.occurrences },
						{ label: "Users", value: issue.users },
						{
							label: "First seen",
							value:
								issue.firstSeen === undefined
									? undefined
									: whenText(issue.firstSeen),
						},
						{
							label: "Last seen",
							value:
								issue.lastSeen === undefined
									? undefined
									: whenText(issue.lastSeen),
						},
					]}
				/>
			</header>

			{writer.changed === null ? null : (
				<p className={styles.changed} role="status">
					{writer.changed}
				</p>
			)}

			<StatusSection issue={issue} actions={actions} writer={writer} />
			<Assignee
				issue={issue}
				actions={actions}
				writer={writer}
				organizationUrl={panel.organizationUrl}
			/>

			{issue.code === undefined ? null : <Location code={issue.code} />}

			{issue.suspect === undefined ? null : (
				<Section title="Suspect commit">
					<SuspectRow suspect={issue.suspect} />
				</Section>
			)}

			<ErrorBlock issue={issue} />
			<Tags tags={issue.tags} />
		</>
	);
};

/** Everything the shared panel needs from this plugin. */
const provider: PanelProvider<IssuePanel, PanelTarget> = {
	emptyMessage: "This panel was opened without an issue.",
	parseParams: (value) => asPanelTarget(value),
	identity: (target) => `${target.organization ?? ""}:${target.id}`,
	title: (target) => target.id,
	fetch: async (target, signal) =>
		await hostApi.issue(target.id, target.organization, signal),
	parse: (value) => asIssuePanel(value),
	view: ({ data, actions }) => <IssueView panel={data} actions={actions} />,
};

/** The panel's body seat. */
export const SentryPanel = createPanelBody(provider);

/** The panel's title seat. */
export const SentryPanelTitle = createPanelTitle(provider);

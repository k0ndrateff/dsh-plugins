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
 * did.
 */

import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import {
	createPanelBody,
	createPanelTitle,
	Fact,
	type PanelActions,
	type PanelProvider,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useState } from "react";
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

/** One date as the reader's own locale writes it. */
function whenText(value: string): string {
	const time = Date.parse(value);

	return Number.isNaN(time)
		? value
		: new Date(time).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
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

/** One titled block. */
const Section = ({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) => (
	<section className={styles.panelSection}>
		<span className={styles.panelSectionTitle}>{title}</span>
		{children}
	</section>
);

interface Actions {
	readonly busy: boolean;
	run: PanelActions<PanelTarget>["run"];
}

/** The status changes Sentry's own vocabulary offers. */
const StatusActions = ({ actions }: { actions: Actions }) => (
	<Section title="Status">
		<div className={styles.actions}>
			<Button
				size="sm"
				variant="outline"
				disabled={actions.busy}
				onClick={() => {
					actions.run((target) => hostApi.setStatus(target.id, "resolved"));
				}}
			>
				Resolve
			</Button>

			<Button
				size="sm"
				variant="outline"
				disabled={actions.busy}
				onClick={() => {
					actions.run((target) =>
						hostApi.setStatus(target.id, "ignored", "untilEscalating"),
					);
				}}
			>
				Ignore
			</Button>

			<Button
				size="sm"
				variant="outline"
				disabled={actions.busy}
				onClick={() => {
					actions.run((target) => hostApi.setStatus(target.id, "unresolved"));
				}}
			>
				Reopen
			</Button>
		</div>
	</Section>
);

/**
 * Hand the issue to a user or a team.
 *
 * Sentry's own reference format is the field's whole contract: the MCP server
 * offers no member search, so there is nothing to offer as a list.
 */
const Assignee = ({ actions }: { actions: Actions }) => {
	const [value, setValue] = useState("");
	const reference = value.trim();

	return (
		<Section title="Assignee">
			<div className={styles.actions}>
				<Input
					className={styles.assignField}
					value={value}
					placeholder="user:123456 or team:backend"
					disabled={actions.busy}
					onChange={(event) => {
						setValue(event.target.value);
					}}
				/>

				<Button
					size="sm"
					variant="outline"
					disabled={actions.busy || reference === ""}
					onClick={() => {
						actions.run((target) => hostApi.assign(target.id, reference));
					}}
				>
					Assign
				</Button>

				<Button
					size="sm"
					variant="ghost"
					disabled={actions.busy}
					onClick={() => {
						actions.run((target) => hostApi.assign(target.id, null));
					}}
				>
					Unassign
				</Button>
			</div>

			<span className={styles.caption}>
				Sentry's own reference: user:&lt;id&gt; or team:&lt;slug&gt;.
			</span>
		</Section>
	);
};

/** Where the error was raised, linked when Sentry named a URL. */
const Location = ({ code }: { code: CodeLocation }) => (
	<Section title="Location">
		{code.url === undefined ? (
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

	return (
		<>
			<header className={styles.panelHead}>
				<div className={styles.panelTitleRow}>
					<span className={styles.panelKey}>{issue.id}</span>

					{issue.url === undefined ? null : (
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

				<div className={styles.badges}>
					<Fact label="Status" value={issue.status} />
					<Fact label="Substatus" value={issue.substatus} />
					<Fact label="Assignee" value={issue.assignee ?? "Unassigned"} />
					<Fact label="Project" value={issue.project} />
					<Fact label="Platform" value={issue.platform} />
					<Fact label="Occurrences" value={issue.occurrences} />
					<Fact label="Users" value={issue.users} />
					<Fact
						label="First seen"
						value={
							issue.firstSeen === undefined
								? undefined
								: whenText(issue.firstSeen)
						}
					/>
					<Fact
						label="Last seen"
						value={
							issue.lastSeen === undefined
								? undefined
								: whenText(issue.lastSeen)
						}
					/>
				</div>
			</header>

			<StatusActions actions={actions} />
			<Assignee actions={actions} />

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
	identity: (target) => target.id,
	title: (target) => target.id,
	fetch: async (target, signal) => await hostApi.issue(target.id, signal),
	parse: (value) => asIssuePanel(value),
	view: ({ data, actions }) => <IssueView panel={data} actions={actions} />,
};

/** The panel's body seat. */
export const SentryPanel = createPanelBody(provider);

/** The panel's title seat. */
export const SentryPanelTitle = createPanelTitle(provider);

/**
 * The Atlassian panel: one issue or page, and the actions that change it.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to show arrives in the
 * tab's navigation parameters, the document itself comes through the host's
 * `/dsh-atlassian` route — only the host half holds the MCP connection — and the
 * loading, failing, retrying and writing belong to `dsh-integration-ui`.
 *
 * Writes are one step at a time: run it, and the host answers with the issue as
 * it now stands, so the panel never renders an assumption about what a
 * transition did. The clicked control says what it is doing and the panel says
 * what changed once the server confirmed it, because a write whose result is
 * silent looks the same as a click that was lost.
 */

import type { MarkdownLabels } from "@deepseek-ai/dsh-client-ui-primitives";
import {
	Button,
	Input,
	MarkdownText,
	Menu,
	type MenuEntry,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
	Chip,
	createPanelBody,
	createPanelTitle,
	Facts,
	type PanelActions,
	type PanelProvider,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	asPanelData,
	asPanelTarget,
	type IssuePanel,
	type PagePanel,
	type PanelComment,
	type PanelData,
	type PanelPerson,
	type PanelTarget,
} from "../../shared/panel";
import { issueTypeTone, priorityTone } from "../../shared/tone";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";
import { type PanelWriter, usePanelWriter } from "./write";

/** Chrome for the Markdown renderer; one identity for the whole panel. */
const MARKDOWN_LABELS: MarkdownLabels = {
	code: { copyLabel: "Copy", copiedLabel: "Copied" },
	footnotes: "Footnotes",
};

/** One moment as the reader's own locale and time zone write it. */
const whenText = (value: string): string => {
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
};

/** One date without a time, as the reader's own locale writes it. */
const dateText = (value: string): string => {
	const time = Date.parse(value);

	return Number.isNaN(time)
		? value
		: new Date(time).toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
};

/** What one comment section's heading says, when the server held more back. */
const commentsTitle = (
	comments: readonly PanelComment[],
	total: number | undefined,
	truncated: boolean,
): string => {
	if (total !== undefined && total > comments.length)
		return `Comments (${comments.length} of ${total})`;

	return truncated
		? `Comments (${comments.length} of more)`
		: `Comments (${comments.length})`;
};

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

/** Rendered Markdown, with links leaving for the browser rather than the page. */
const Prose = ({ text }: { text: string }) => (
	<div className={styles.panelBody}>
		<MarkdownText text={text} labels={MARKDOWN_LABELS} variant="compact" />
	</div>
);

/** The comment thread of an issue or a page. */
const Comments = ({ comments }: { comments: readonly PanelComment[] }) => {
	if (comments.length === 0)
		return <span className={styles.caption}>No comments.</span>;

	return (
		<ul className={styles.comments}>
			{comments.map((comment, index) => (
				<li
					key={`${comment.author ?? "comment"}-${comment.created ?? index}`}
					className={styles.comment}
				>
					<div className={styles.commentHead}>
						<span className={styles.commentAuthor}>
							{comment.author ?? "Someone"}
						</span>
						{comment.created === undefined ? null : (
							<span className={styles.caption}>
								{whenText(comment.created)}
							</span>
						)}
					</div>
					<Prose text={comment.body} />
				</li>
			))}
		</ul>
	);
};

interface Actions {
	readonly busy: boolean;
	run: PanelActions<PanelTarget>["run"];
}

/** The transitions the workflow offers right now. */
const Transitions = ({
	issue,
	actions,
	writer,
}: {
	issue: IssuePanel;
	actions: Actions;
	writer: PanelWriter;
}) => {
	const unavailable = issue.transitions.filter(
		(transition) => !transition.available && !transition.needsFields,
	);
	const blocked = issue.transitions.filter(
		(transition) => transition.needsFields,
	);

	return (
		<Section title="Move to">
			{issue.transitionsError === undefined ? null : (
				<span className={styles.caption}>
					The workflow could not be loaded: {issue.transitionsError}
				</span>
			)}

			{issue.transitions.length === 0 ? (
				issue.transitionsError === undefined ? (
					<span className={styles.caption}>
						The workflow offers no transitions for this issue right now.
					</span>
				) : null
			) : (
				<div className={styles.actions}>
					{issue.transitions.map((transition) => (
						<Button
							key={transition.id}
							size="sm"
							variant="outline"
							disabled={
								actions.busy || !transition.available || transition.needsFields
							}
							onClick={() => {
								writer.run(
									transition.id,
									transition.to === undefined
										? `Applied “${transition.name}”.`
										: `Moved to ${transition.to}.`,
									(target) => {
										if (target.kind !== "issue")
											throw new Error("this panel is not showing an issue");

										return hostApi.transitionIssue(
											target.key,
											transition.id,
											target.cloudId,
										);
									},
								);
							}}
						>
							{writer.pending === transition.id
								? `${transition.name}…`
								: transition.to === undefined
									? transition.name
									: `${transition.name} → ${transition.to}`}
						</Button>
					))}
				</div>
			)}

			{unavailable.length === 0 ? null : (
				<span className={styles.caption}>
					{`Not available for this issue right now: ${unavailable
						.map((transition) => transition.name)
						.join(", ")}.`}
				</span>
			)}

			{blocked.length === 0 ? null : (
				<span className={styles.caption}>
					{`${blocked
						.map((transition) => transition.name)
						.join(
							", ",
						)} open${blocked.length === 1 ? "s" : ""} a form with required fields; use the Atlassian site.`}
				</span>
			)}
		</Section>
	);
};

/** People assigned from this page's session, so the second assignment is one click. */
const remembered: PanelPerson[] = [];

/** How many remembered people the menu offers. */
const REMEMBERED_LIMIT = 4;

/** Remember one person, most recent first. */
const remember = (person: PanelPerson): void => {
	if (remembered.some((known) => known.accountId === person.accountId)) return;

	remembered.unshift(person);
	remembered.length = Math.min(remembered.length, REMEMBERED_LIMIT);
};

/**
 * Hand the issue to somebody else.
 *
 * The site's people lookup needs a search string, so the panel cannot offer a
 * list of everybody — but it should not make the reader type a name it already
 * knows either. The reader themselves is one click, the people assigned to from
 * this session are remembered, and the search field appears only when somebody
 * new has to be found by name. A search that matched nobody and a search that
 * failed say so, rather than leaving the reader with a blank list.
 */
const Assignee = ({
	issue,
	actions,
	writer,
}: {
	issue: IssuePanel;
	actions: Actions;
	writer: PanelWriter;
}) => {
	const [open, setOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [query, setQuery] = useState("");
	const [people, setPeople] = useState<readonly PanelPerson[]>([]);
	const [searched, setSearched] = useState(false);
	const [searchFailure, setSearchFailure] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [me, setMe] = useState<PanelPerson | null>(null);
	const [known, setKnown] = useState<readonly PanelPerson[]>(remembered);

	// Who the reader is, asked once: without it the panel simply offers no
	// self-assignment, and the search stays the only way to name anybody.
	useEffect(() => {
		let live = true;

		hostApi
			.me()
			.then((person) => {
				if (live) setMe(person);
			})
			.catch(() => undefined);

		return () => {
			live = false;
		};
	}, []);

	useEffect(() => {
		const trimmed = query.trim();

		if (trimmed.length < 2) {
			setPeople([]);
			setFetching(false);
			setSearched(false);
			setSearchFailure(null);

			return;
		}

		const controller = new AbortController();
		// One search per pause in typing: the site's lookup is not free.
		const timer = setTimeout(() => {
			setFetching(true);
			setSearchFailure(null);
			hostApi
				.findPeople(trimmed, controller.signal)
				.then((found) => {
					if (controller.signal.aborted) return;

					setPeople(found);
					setSearched(true);
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted) return;

					setPeople([]);
					setSearched(true);
					setSearchFailure(
						error instanceof Error ? error.message : String(error),
					);
				})
				.finally(() => {
					if (!controller.signal.aborted) setFetching(false);
				});
		}, 300);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, attempt]);

	const assign = (person: PanelPerson | null): void => {
		if (person !== null) {
			remember(person);
			setKnown([...remembered]);
		}

		setQuery("");
		setSearchOpen(false);
		writer.run(
			person === null ? "unassign" : "assign",
			person === null ? "Unassigned." : `Assigned to ${person.name}.`,
			(target) => {
				if (target.kind !== "issue")
					throw new Error("this panel is not showing an issue");

				return hostApi.assignIssue(
					target.key,
					person?.accountId ?? null,
					target.cloudId,
				);
			},
		);
	};

	const entries: MenuEntry[] = [
		...(me === null || me.accountId === issue.assignee?.accountId
			? []
			: [{ id: `person:${me.accountId}`, label: `Assign to me (${me.name})` }]),
		...known
			.filter((person) => person.accountId !== me?.accountId)
			.map((person) => ({
				id: `person:${person.accountId}`,
				label: person.name,
			})),
		{ id: "search", label: "Search people…" },
	];

	/** The person one menu id names, or null when it was not a person. */
	const personFor = (id: string): PanelPerson | null => {
		if (me !== null && id === `person:${me.accountId}`) return me;

		return known.find((person) => id === `person:${person.accountId}`) ?? null;
	};

	return (
		<Section title="Assignee">
			<div className={styles.row}>
				<span className={styles.caption}>
					{issue.assignee?.name ?? "Nobody is assigned."}
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

						if (id === "search") {
							setSearchOpen(true);
							return;
						}

						assign(personFor(id));
					}}
					footer={
						issue.assignee === undefined
							? []
							: [{ id: "unassign", label: "Unassign", danger: true }]
					}
					anchor={
						<Button
							size="sm"
							variant="ghost"
							disabled={actions.busy}
							onClick={() => {
								if (open) {
									setOpen(false);
									return;
								}

								setSearchOpen(false);
								setOpen(true);
							}}
						>
							{writer.pending === "assign" ? "Assigning…" : "Change"}
						</Button>
					}
				/>
			</div>

			{searchOpen ? (
				<>
					<div className={styles.actions}>
						<Input
							className={styles.personSearch}
							value={query}
							placeholder="Search people…"
							aria-label="Search people by name"
							disabled={actions.busy}
							onChange={(event) => {
								setQuery(event.target.value);
							}}
						/>

						<Button
							size="sm"
							variant="ghost"
							disabled={actions.busy}
							onClick={() => {
								setQuery("");
								setSearchOpen(false);
							}}
						>
							Cancel
						</Button>
					</div>

					{query.trim().length < 2 ? (
						<span className={styles.caption}>
							Two letters are enough to search the site.
						</span>
					) : null}

					{fetching ? <span className={styles.caption}>Searching…</span> : null}

					{searched &&
					!fetching &&
					searchFailure === null &&
					people.length === 0 ? (
						<span className={styles.caption}>No people matched.</span>
					) : null}

					{searchFailure === null ? null : (
						<div className={styles.actions}>
							<span className={styles.caption}>
								The people search failed: {searchFailure}
							</span>

							<Button
								size="sm"
								variant="outline"
								disabled={fetching}
								onClick={() => {
									setAttempt((count) => count + 1);
								}}
							>
								Try again
							</Button>
						</div>
					)}

					{people.length === 0 ? null : (
						<ul className={styles.people}>
							{people.map((person) => (
								<li key={person.accountId}>
									<button
										type="button"
										className={styles.person}
										disabled={actions.busy}
										onClick={() => {
											assign(person);
										}}
									>
										{person.name}
									</button>
								</li>
							))}
						</ul>
					)}
				</>
			) : null}
		</Section>
	);
};

/** One issue: what it is, how it is doing, and what may be done to it. */
const IssueView = ({
	issue,
	actions,
}: {
	issue: IssuePanel;
	actions: Actions;
}) => {
	const writer = usePanelWriter(actions, `issue:${issue.key}`);

	return (
		<>
			<header className={styles.panelHead}>
				<div className={styles.panelTitleRow}>
					<Chip value={issue.type} tone={issueTypeTone(issue.type)} />
					{issue.url === undefined ? (
						<span className={styles.panelKey}>{issue.key}</span>
					) : (
						<a
							className={`${styles.link} ${styles.panelKey}`}
							href={issue.url}
							target="_blank"
							rel="noreferrer"
						>
							{issue.key}
						</a>
					)}
				</div>
				<h2 className={styles.panelSummary}>{issue.summary ?? issue.key}</h2>

				<Facts
					items={[
						{ label: "Status", value: issue.status },
						{
							label: "Priority",
							value:
								issue.priority === undefined ? undefined : (
									<Chip
										value={issue.priority}
										tone={priorityTone(issue.priority)}
									/>
								),
						},
						{ label: "Reporter", value: issue.reporter },
						{ label: "Estimate", value: issue.estimate },
						{
							label: "Due",
							value: issue.due === undefined ? undefined : dateText(issue.due),
						},
					]}
				/>

				{issue.labels.length === 0 ? null : (
					<div className={styles.badges}>
						{issue.labels.map((label) => (
							<Chip key={label} value={label} tone="neutral" />
						))}
					</div>
				)}
			</header>

			{writer.changed === null ? null : (
				<p className={styles.changed} role="status">
					{writer.changed}
				</p>
			)}

			<Transitions issue={issue} actions={actions} writer={writer} />
			<Assignee issue={issue} actions={actions} writer={writer} />

			<Section title="Description">
				{issue.description === undefined ? (
					<span className={styles.caption}>No description.</span>
				) : (
					<Prose text={issue.description} />
				)}
			</Section>

			<Section
				title={commentsTitle(
					issue.comments,
					issue.commentTotal,
					issue.commentsTruncated === true,
				)}
			>
				<Comments comments={issue.comments} />

				{issue.commentTotal !== undefined &&
				issue.commentTotal > issue.comments.length &&
				issue.url !== undefined ? (
					<a
						className={styles.link}
						href={issue.url}
						target="_blank"
						rel="noreferrer"
					>
						{`Read all ${issue.commentTotal} comments in Jira`}
					</a>
				) : null}

				{issue.commentsTruncated === true &&
				(issue.commentTotal === undefined ||
					issue.commentTotal <= issue.comments.length) &&
				issue.url !== undefined ? (
					<a
						className={styles.link}
						href={issue.url}
						target="_blank"
						rel="noreferrer"
					>
						More comments are in Jira
					</a>
				) : null}
			</Section>

			{issue.updated === undefined ? null : (
				<span className={styles.caption}>
					Updated {whenText(issue.updated)}
				</span>
			)}
		</>
	);
};

/** One Confluence page: its body and its comments. */
const PageView = ({ page }: { page: PagePanel }) => (
	<>
		<header className={styles.panelHead}>
			<div className={styles.panelTitleRow}>
				<Chip value="Page" tone="neutral" />
				{page.space === undefined ? null : (
					<span className={styles.panelKey}>{page.space}</span>
				)}
			</div>
			<h2 className={styles.panelSummary}>{page.title}</h2>
			{page.url === undefined ? null : (
				<a
					className={styles.link}
					href={page.url}
					target="_blank"
					rel="noreferrer"
				>
					Open in Confluence
				</a>
			)}
		</header>

		<Section title="Content">
			{page.body === undefined ? (
				<span className={styles.caption}>No content.</span>
			) : (
				<Prose text={page.body} />
			)}
		</Section>

		<Section
			title={commentsTitle(
				page.comments,
				page.commentTotal,
				page.commentsTruncated === true,
			)}
		>
			<Comments comments={page.comments} />

			{page.commentsTruncated === true && page.url !== undefined ? (
				<a
					className={styles.link}
					href={page.url}
					target="_blank"
					rel="noreferrer"
				>
					More comments are in Confluence
				</a>
			) : null}
		</Section>
	</>
);

/** Everything the shared panel needs from this plugin. */
const provider: PanelProvider<PanelData, PanelTarget> = {
	emptyMessage: "This panel was opened without an issue or a page.",
	parseParams: (value) => asPanelTarget(value),
	identity: (target) =>
		target.kind === "issue"
			? `issue:${target.cloudId ?? ""}:${target.key}`
			: `page:${target.cloudId ?? ""}:${target.id}`,
	title: (target) =>
		target.kind === "issue" ? target.key : (target.title ?? "Page"),
	fetch: async (target, signal) => await hostApi.getPanel(target, signal),
	parse: (value) => asPanelData(value),
	view: ({ data, actions }) =>
		data.kind === "issue" ? (
			<IssueView issue={data} actions={actions} />
		) : (
			<PageView page={data} />
		),
};

/** The panel's body seat. */
export const AtlassianPanel = createPanelBody(provider);

/** The panel's title seat. */
export const AtlassianPanelTitle = createPanelTitle(provider);

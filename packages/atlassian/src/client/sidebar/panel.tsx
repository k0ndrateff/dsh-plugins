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
 * transition did.
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

/** Chrome for the Markdown renderer; one identity for the whole panel. */
const MARKDOWN_LABELS: MarkdownLabels = {
	code: { copyLabel: "Copy", copiedLabel: "Copied" },
	footnotes: "Footnotes",
};

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

/**
 * Run one write against the issue the panel is showing.
 *
 * A page has no workflow and no assignee, so a write is refused rather than
 * sent at whatever the panel happens to hold.
 * @param actions - the shared body's action set.
 * @param write - the call, which takes the issue's key.
 */
const runIssue = (
	actions: Actions,
	write: (key: string) => Promise<unknown>,
): void => {
	actions.run(async (target) => {
		if (target.kind !== "issue")
			throw new Error("this panel is not showing an issue");

		return await write(target.key);
	});
};

/** The transitions the workflow offers right now. */
const Transitions = ({
	issue,
	actions,
}: {
	issue: IssuePanel;
	actions: Actions;
}) => {
	if (issue.transitions.length === 0) return null;

	const blocked = issue.transitions.some(
		(transition) => transition.needsFields,
	);

	return (
		<Section title="Move to">
			<div className={styles.actions}>
				{issue.transitions.map((transition) => (
					<Button
						key={transition.id}
						size="sm"
						variant="outline"
						disabled={
							actions.busy || !transition.available || transition.needsFields
						}
						title={
							transition.needsFields
								? `${transition.name} opens a screen with required fields`
								: transition.to === undefined
									? transition.name
									: `${transition.name} → ${transition.to}`
						}
						onClick={() => {
							runIssue(actions, (key) =>
								hostApi.transitionIssue(key, transition.id),
							);
						}}
					>
						{transition.name}
					</Button>
				))}
			</div>
			{blocked ? (
				<span className={styles.caption}>
					A transition that needs a form is left to the Atlassian site.
				</span>
			) : null}
		</Section>
	);
};

/** People assigned from this page's session, so the second assignment is one click. */
const remembered: PanelPerson[] = [];

/** How many remembered people the menu offers. */
const REMEMBERED_LIMIT = 4;

/** Remember one person, most recent first. */
function remember(person: PanelPerson): void {
	if (remembered.some((known) => known.accountId === person.accountId)) return;

	remembered.unshift(person);
	remembered.length = Math.min(remembered.length, REMEMBERED_LIMIT);
}

/**
 * Hand the issue to somebody else.
 *
 * The site's people lookup needs a search string, so the panel cannot offer a
 * list of everybody — but it should not make the reader type a name it already
 * knows either. The reader themselves is one click, the people assigned to from
 * this session are remembered, and the search field appears only when somebody
 * new has to be found by name.
 */
const Assignee = ({
	issue,
	actions,
}: {
	issue: IssuePanel;
	actions: Actions;
}) => {
	const [open, setOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [fetching, setFetching] = useState(false);
	const [query, setQuery] = useState("");
	const [people, setPeople] = useState<readonly PanelPerson[]>([]);
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
			return;
		}

		const controller = new AbortController();
		// One search per pause in typing: the site's lookup is not free.
		const timer = setTimeout(() => {
			setFetching(true);
			hostApi
				.findPeople(trimmed, controller.signal)
				.then((found) => {
					if (!controller.signal.aborted) setPeople(found);
				})
				.catch(() => undefined)
				.finally(() => {
					if (!controller.signal.aborted) setFetching(false);
				});
		}, 300);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);

	const assign = (person: PanelPerson | null): void => {
		if (person !== null) {
			remember(person);
			setKnown([...remembered]);
		}

		setQuery("");
		setSearchOpen(false);
		runIssue(actions, (key) =>
			hostApi.assignIssue(key, person?.accountId ?? null),
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
							Change
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
}) => (
	<>
		<header className={styles.panelHead}>
			<div className={styles.panelTitleRow}>
				<Chip value={issue.type} tone={issueTypeTone(issue.type)} />
				<a
					className={`${styles.link} ${styles.panelKey}`}
					href={issue.url}
					target="_blank"
					rel="noreferrer"
				>
					{issue.key}
				</a>
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
					{ label: "Due", value: issue.due },
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

		<Transitions issue={issue} actions={actions} />
		<Assignee issue={issue} actions={actions} />

		<Section title="Description">
			{issue.description === undefined ? (
				<span className={styles.caption}>No description.</span>
			) : (
				<Prose text={issue.description} />
			)}
		</Section>

		<Section title={`Comments (${issue.comments.length})`}>
			<Comments comments={issue.comments} />
		</Section>

		{issue.updated === undefined ? null : (
			<span className={styles.caption}>Updated {whenText(issue.updated)}</span>
		)}
	</>
);

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

		<Section title={`Comments (${page.comments.length})`}>
			<Comments comments={page.comments} />
		</Section>
	</>
);

/** Everything the shared panel needs from this plugin. */
const provider: PanelProvider<PanelData, PanelTarget> = {
	emptyMessage: "This panel was opened without an issue or a page.",
	parseParams: (value) => asPanelTarget(value),
	identity: (target) =>
		target.kind === "issue" ? `issue:${target.key}` : `page:${target.id}`,
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

/**
 * The Atlassian panel: one issue or page, and the actions that change it.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. It reads what to show from
 * its tab's navigation parameters — the Sidebar hands those to every body — and
 * fetches the document through the host's `/dsh-atlassian` route, because only
 * the host half holds the MCP connection.
 *
 * Writes are the same channel, one step at a time: run it, and the host answers
 * with the issue as it now stands, so the panel never renders an assumption
 * about what a transition did.
 */

import type { MarkdownLabels } from "@deepseek-ai/dsh-client-ui-primitives";
import {
	Button,
	Input,
	MarkdownDelegateProvider,
	MarkdownText,
	Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Badge } from "../components/badge";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";

/** Chrome for the Markdown renderer; one identity for the whole panel. */
const MARKDOWN_LABELS: MarkdownLabels = {
	code: { copyLabel: "Copy", copiedLabel: "Copied" },
	footnotes: "Footnotes",
};

/** What the panel currently knows. */
type Load =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly data: PanelData }
	| { readonly status: "error"; readonly message: string };

/** The write one panel may ask the host to perform. */
type Write =
	| { readonly kind: "transition"; readonly id: string }
	| { readonly kind: "assign"; readonly accountId: string | null };

/** The reason inside an unknown thrown value, as a sentence. */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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
	run: (write: Write) => void;
}

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
							actions.run({ kind: "transition", id: transition.id });
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

/** Hand the issue to somebody else, by searching the site's people. */
const Assignee = ({
	issue,
	actions,
}: {
	issue: IssuePanel;
	actions: Actions;
}) => {
	const [query, setQuery] = useState("");
	const [people, setPeople] = useState<readonly PanelPerson[]>([]);
	const [searching, setSearching] = useState(false);

	useEffect(() => {
		const trimmed = query.trim();

		if (trimmed.length < 2) {
			setPeople([]);
			return;
		}

		const controller = new AbortController();
		// One search per pause in typing: the site's lookup is not free.
		const timer = setTimeout(() => {
			setSearching(true);
			hostApi
				.findPeople(trimmed, controller.signal)
				.then((found) => {
					if (!controller.signal.aborted) setPeople(found);
				})
				.catch(() => undefined)
				.finally(() => {
					if (!controller.signal.aborted) setSearching(false);
				});
		}, 300);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);

	return (
		<Section title="Assignee">
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
				{issue.assignee === undefined ? null : (
					<Button
						size="sm"
						variant="ghost"
						disabled={actions.busy}
						onClick={() => {
							actions.run({ kind: "assign", accountId: null });
						}}
					>
						Unassign
					</Button>
				)}
			</div>
			{searching ? <span className={styles.caption}>Searching…</span> : null}
			{people.length === 0 ? null : (
				<ul className={styles.people}>
					{people.map((person) => (
						<li key={person.accountId}>
							<button
								type="button"
								className={styles.person}
								disabled={actions.busy}
								onClick={() => {
									actions.run({
										kind: "assign",
										accountId: person.accountId,
									});
								}}
							>
								{person.name}
							</button>
						</li>
					))}
				</ul>
			)}
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
				<Badge value={issue.type} tone={issueTypeTone(issue.type)} />
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
			<div className={styles.badges}>
				<Badge label="Status" value={issue.status} />
				<Badge
					label="Priority"
					value={issue.priority}
					tone={priorityTone(issue.priority)}
				/>
				<Badge label="Assignee" value={issue.assignee?.name ?? "Unassigned"} />
				<Badge label="Reporter" value={issue.reporter} />
				<Badge label="Estimate" value={issue.estimate} />
				<Badge label="Due" value={issue.due} />
				{issue.labels.map((label) => (
					<Badge key={label} value={label} tone="neutral" />
				))}
			</div>
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
				<Tag tone="neutral">Page</Tag>
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

/**
 * The panel's body seat.
 * @param props - the tab's live information, including what it was opened on.
 * @returns the panel, filling the pane it was given.
 */
export const AtlassianPanel = (
	props: PropsRuntime<"sidebar.right.pane.tab">,
): ReactNode => {
	const { tab } = props.useTabInfo();
	const target = asPanelTarget(tab.navigation.params);
	const revision = tab.navigation.revision;
	const identity =
		target === undefined
			? ""
			: target.kind === "issue"
				? `issue:${target.key}`
				: `page:${target.id}`;

	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	// The effect below is keyed by identity, so the fetch reads the target from a
	// ref rather than closing over one render's copy of it.
	const current = useRef<PanelTarget | undefined>(target);
	current.current = target;

	const fetchPanel = useCallback(
		async (signal?: AbortSignal): Promise<void> => {
			const wanted = current.current;

			if (wanted === undefined) {
				setLoad({
					status: "error",
					message: "This panel was opened without an issue or a page.",
				});
				return;
			}

			setLoad({ status: "loading" });

			try {
				const data = asPanelData(await hostApi.getPanel(wanted, signal));

				if (data === undefined)
					throw new Error(
						"the host answered with a document this version cannot draw",
					);
				if (signal?.aborted !== true) setLoad({ status: "ready", data });
			} catch (error) {
				if (signal?.aborted !== true)
					setLoad({ status: "error", message: messageOf(error) });
			}
		},
		[],
	);

	useEffect(() => {
		const controller = new AbortController();
		setFailure(undefined);
		void fetchPanel(controller.signal);

		return () => {
			controller.abort();
		};
	}, [identity, revision, fetchPanel]);

	/** One write, then the truth about what it did. */
	const run = useCallback(
		(write: Write): void => {
			const wanted = current.current;
			if (wanted === undefined || wanted.kind !== "issue") return;

			setBusy(true);
			setFailure(undefined);

			const call =
				write.kind === "transition"
					? hostApi.transitionIssue(wanted.key, write.id)
					: hostApi.assignIssue(wanted.key, write.accountId);

			call
				.then((issue) => {
					setLoad({ status: "ready", data: issue });
				})
				.catch((error: unknown) => {
					setFailure(messageOf(error));
					// The write may have failed after the site changed nothing; asking
					// again is what tells the two apart.
					void fetchPanel();
				})
				.finally(() => {
					setBusy(false);
				});
		},
		[fetchPanel],
	);

	const actions: Actions = { busy, run };

	return (
		<div className={styles.panel}>
			<div className={styles.panelScroll}>
				{load.status === "loading" ? (
					<span className={styles.caption}>Loading…</span>
				) : null}

				{load.status === "error" ? (
					<>
						<p className={styles.error}>{load.message}</p>
						<div className={styles.actions}>
							<Button size="sm" onClick={() => void fetchPanel()}>
								Try again
							</Button>
						</div>
					</>
				) : null}

				{failure === undefined ? null : (
					<p className={styles.error}>{failure}</p>
				)}

				{load.status === "ready" ? (
					<MarkdownDelegateProvider
						// Markdown links belong to the browser: a click here must not
						// navigate the panel itself away from the harness.
						openExternalLink={(href) => {
							window.open(href, "_blank", "noopener,noreferrer");
						}}
					>
						{load.data.kind === "issue" ? (
							<IssueView issue={load.data} actions={actions} />
						) : (
							<PageView page={load.data} />
						)}
					</MarkdownDelegateProvider>
				) : null}
			</div>
		</div>
	);
};

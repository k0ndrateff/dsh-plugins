/**
 * The Discussions tab: every review thread, and the actions on them.
 *
 * A thread is where review actually happens — a bot or a colleague names a file
 * and a line and asks for something — so this is the tab the CodeRabbit workflow
 * runs in: filter to the findings or to what is still unresolved, read the ask,
 * reply, and resolve it once the code agrees. The filter is by what a thread is
 * rather than by who wrote it, because a review bot posts under an ordinary
 * account whose name says nothing about it.
 *
 * Every action here is social, so none of them is sent from the click: the
 * panel shows the exact wording and waits for Send. The draft, its "Sending…"
 * state, its failure and the later confirmation all render under the thread they
 * belong to, and the composer stays open until the draft exists — a long list of
 * discussions never separates the click from what it did.
 */

import {
	Button,
	InlineEditor,
	SegmentedControl,
	type SegmentedControlOption,
	Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { PanelActions } from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
	type Discussion,
	type DiscussionNote,
	isFinding,
	type MergeRequestDetail,
	type PanelTarget,
} from "../../shared/panel";
import type { ReviewState } from "../sidebar/review";
import * as styles from "../styles/styles.css";
import { Prose, Section, whenText } from "./blocks";
import { ConfirmRow } from "./confirm-row";

/** How the thread list is narrowed. */
type Filter = "all" | "unresolved" | "findings";

const FILTERS: readonly SegmentedControlOption<Filter>[] = [
	{ value: "all", label: "All" },
	{ value: "unresolved", label: "Unresolved" },
	{ value: "findings", label: "Findings" },
];

/** What an empty list says, so "no unresolved" is not mistaken for "no threads". */
const EMPTY_TEXT: Readonly<Record<Filter, string>> = {
	all: "This merge request has no discussions yet.",
	unresolved: "No unresolved threads — nothing is waiting for a reply.",
	findings: "No review findings on this merge request.",
};

/** The first note a person or a bot wrote, which is what a thread is about. */
const openingNote = (discussion: Discussion): DiscussionNote | undefined =>
	discussion.notes.find((note) => !note.system);

/** `path:line`, as the thread's own position spells it. */
function positionText(discussion: Discussion): string | undefined {
	const position = openingNote(discussion)?.position;
	if (position?.file === undefined) return undefined;

	const line = position.newLine ?? position.oldLine;
	const side =
		position.newLine === undefined && position.oldLine !== undefined
			? " (removed)"
			: "";

	return line === undefined ? position.file : `${position.file}:${line}${side}`;
}

/** One note of a thread. */
const Note = ({ note, index }: { note: DiscussionNote; index: number }) => (
	<div className={styles.note} key={note.id ?? index}>
		<div className={styles.noteHead}>
			<span className={styles.noteAuthor}>
				{note.author?.username ?? "GitLab"}
			</span>

			{note.createdAt === undefined ? null : (
				<span className={styles.caption}>{whenText(note.createdAt)}</span>
			)}

			{note.system ? <Tag tone="quiet">activity</Tag> : null}
			{note.internal ? <Tag tone="warning">internal</Tag> : null}
		</div>

		{note.system ? (
			<span className={styles.caption}>{note.body}</span>
		) : (
			<Prose text={note.body} />
		)}
	</div>
);

interface ThreadProps {
	readonly discussion: Discussion;
	readonly mr: MergeRequestDetail;
	readonly review: ReviewState;
	readonly actions: PanelActions<PanelTarget>;
	/** Whether a card opened the panel on this very thread. */
	readonly focused: boolean;
}

/** One thread, its notes, and the actions it offers. */
const Thread = ({ discussion, mr, review, actions, focused }: ThreadProps) => {
	const [reply, setReply] = useState<string | undefined>(undefined);
	const row = useRef<HTMLLIElement>(null);
	const where = positionText(discussion);
	const bot = openingNote(discussion)?.author?.bot === true;

	// A card that named this thread lands on it rather than on the top of the list.
	useEffect(() => {
		if (focused) row.current?.scrollIntoView({ block: "nearest" });
	}, [focused]);

	const pending =
		review.draft !== null &&
		review.draft.discussionId === discussion.id &&
		(review.draft.action === "reply" ||
			review.draft.action === "resolve" ||
			review.draft.action === "unresolve")
			? review.draft
			: null;

	const failure =
		review.error !== undefined &&
		review.error.place.discussionId === discussion.id
			? review.error.message
			: undefined;

	const notice =
		review.notice !== undefined &&
		review.notice.place.discussionId === discussion.id
			? review.notice.message
			: undefined;

	return (
		<li
			ref={row}
			className={`${styles.thread} ${focused ? styles.threadFocused : ""}`}
		>
			<div className={styles.threadHead}>
				<span className={styles.threadFile}>{where ?? "General note"}</span>

				{discussion.resolvable ? (
					<Tag tone={discussion.resolved ? "success" : "warning"}>
						{discussion.resolved ? "resolved" : "unresolved"}
					</Tag>
				) : (
					<Tag tone="quiet">note</Tag>
				)}

				{bot ? <Tag tone="info">bot</Tag> : null}

				<span className={styles.caption}>
					{`${discussion.notes.length} note${discussion.notes.length === 1 ? "" : "s"}`}
				</span>
			</div>

			{discussion.notes.map((note, index) => (
				<Note key={note.id ?? index} note={note} index={index} />
			))}

			<div className={styles.actions}>
				<Button
					size="sm"
					variant="outline"
					disabled={review.busy || review.sending}
					onClick={() => {
						setReply("");
					}}
				>
					Reply
				</Button>

				{discussion.resolvable ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={review.busy || review.sending}
						onClick={() => {
							void review.propose({
								project: mr.project,
								iid: mr.iid,
								action: discussion.resolved ? "unresolve" : "resolve",
								discussionId: discussion.id,
							});
						}}
					>
						{discussion.resolved ? "Reopen" : "Resolve"}
					</Button>
				) : null}
			</div>

			{reply === undefined ? null : (
				<InlineEditor
					value={reply}
					label="Reply in this thread"
					onChange={setReply}
					onSave={() => {
						if (review.busy) return;

						// The editor closes only once the host answered with a draft: an error
						// leaves what was typed in place, so it can be sent again.
						void review
							.propose({
								project: mr.project,
								iid: mr.iid,
								action: "reply",
								discussionId: discussion.id,
								body: reply,
							})
							.then((opened) => {
								if (opened) setReply(undefined);
							});
					}}
					onCancel={() => {
						setReply(undefined);
					}}
				/>
			)}

			{pending === null && failure !== undefined ? (
				<p className={styles.error} role="alert">
					{failure}
				</p>
			) : null}

			{pending === null ? null : (
				<ConfirmRow
					draft={pending}
					busy={actions.busy || review.busy || review.sending}
					sending={review.sending}
					failure={failure}
					threadLabel={where}
					onSend={() => {
						review.send(actions);
					}}
					onCancel={review.cancel}
				/>
			)}

			{notice === undefined ? null : (
				<span className={styles.notice} role="status">
					{notice}
				</span>
			)}
		</li>
	);
};

interface Props {
	readonly mr: MergeRequestDetail;
	readonly discussions: readonly Discussion[];
	readonly review: ReviewState;
	readonly actions: PanelActions<PanelTarget>;
	/** The thread a card asked the panel to open on. */
	readonly focusDiscussionId?: string;
}

/** Every thread on the merge request, and the composer for a new one. */
export const MrDiscussions = ({
	mr,
	discussions,
	review,
	actions,
	focusDiscussionId,
}: Props): ReactNode => {
	const [filter, setFilter] = useState<Filter>("all");
	const [comment, setComment] = useState<string | undefined>(undefined);

	const unresolved = discussions.filter(
		(discussion) => !discussion.resolved && discussion.resolvable,
	).length;
	const findings = discussions.filter((discussion) =>
		isFinding(discussion),
	).length;

	const shown = discussions.filter((discussion) => {
		// The thread a pending draft belongs to stays visible whatever the filter,
		// so its confirmation cannot be hidden behind a narrowed list.
		if (review.draft?.discussionId === discussion.id) return true;
		if (filter === "unresolved")
			return !discussion.resolved && discussion.resolvable;
		if (filter === "findings") return isFinding(discussion);

		return true;
	});

	const commentDraft =
		review.draft !== null && review.draft.action === "comment"
			? review.draft
			: null;
	const commentFailure =
		review.error !== undefined && review.error.place.action === "comment"
			? review.error.message
			: undefined;
	const commentNotice =
		review.notice !== undefined && review.notice.place.action === "comment"
			? review.notice.message
			: undefined;

	return (
		<Section title={`Discussions (${discussions.length})`}>
			<SegmentedControl
				id="gitlab-discussion-filter"
				value={filter}
				options={FILTERS.map((option) =>
					option.value === "unresolved"
						? { ...option, label: `Unresolved (${unresolved})` }
						: option.value === "findings"
							? { ...option, label: `Findings (${findings})` }
							: option,
				)}
				onChange={setFilter}
				label="Which discussions to show"
			/>

			{comment === undefined ? (
				<Button
					size="sm"
					variant="outline"
					disabled={review.busy || review.sending}
					onClick={() => {
						setComment("");
					}}
				>
					Write a comment
				</Button>
			) : (
				<InlineEditor
					value={comment}
					label="Comment on this merge request"
					onChange={setComment}
					onSave={() => {
						if (review.busy) return;

						void review
							.propose({
								project: mr.project,
								iid: mr.iid,
								action: "comment",
								body: comment,
							})
							.then((opened) => {
								if (opened) setComment(undefined);
							});
					}}
					onCancel={() => {
						setComment(undefined);
					}}
				/>
			)}

			{commentDraft === null && commentFailure !== undefined ? (
				<p className={styles.error} role="alert">
					{commentFailure}
				</p>
			) : null}

			{commentDraft === null ? null : (
				<ConfirmRow
					draft={commentDraft}
					busy={actions.busy || review.busy || review.sending}
					sending={review.sending}
					failure={commentFailure}
					onSend={() => {
						review.send(actions);
					}}
					onCancel={review.cancel}
				/>
			)}

			{commentNotice === undefined ? null : (
				<span className={styles.notice} role="status">
					{commentNotice}
				</span>
			)}

			{shown.length === 0 ? (
				<span className={styles.caption}>{EMPTY_TEXT[filter]}</span>
			) : (
				<ul className={styles.list} data-layout="list">
					{shown.map((discussion) => (
						<Thread
							key={discussion.id}
							discussion={discussion}
							mr={mr}
							review={review}
							actions={actions}
							focused={focusDiscussionId === discussion.id}
						/>
					))}
				</ul>
			)}
		</Section>
	);
};

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
 * panel shows the exact wording and waits for Send.
 */

import {
	Button,
	InlineEditor,
	SegmentedControl,
	type SegmentedControlOption,
	Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import { useState } from "react";
import {
	type Discussion,
	type DiscussionNote,
	isFinding,
	type MergeRequestDetail,
} from "../../shared/panel";
import type { ReviewState } from "../sidebar/review";
import * as styles from "../styles/styles.css";
import { Prose, Section, whenText } from "./blocks";

/** How the thread list is narrowed. */
type Filter = "all" | "unresolved" | "findings";

const FILTERS: readonly SegmentedControlOption<Filter>[] = [
	{ value: "all", label: "All" },
	{ value: "unresolved", label: "Unresolved" },
	{ value: "findings", label: "Findings" },
];

/** The first note a person or a bot wrote, which is what a thread is about. */
const openingNote = (discussion: Discussion): DiscussionNote | undefined =>
	discussion.notes.find((note) => !note.system);

/** `path:line`, as the thread's own position spells it. */
function positionText(discussion: Discussion): string | undefined {
	const position = openingNote(discussion)?.position;
	if (position?.file === undefined) return undefined;

	const line = position.newLine ?? position.oldLine;

	return line === undefined ? position.file : `${position.file}:${line}`;
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
}

/** One thread, its notes, and the actions it offers. */
const Thread = ({ discussion, mr, review }: ThreadProps) => {
	const [reply, setReply] = useState<string | undefined>(undefined);
	const where = positionText(discussion);
	const bot = openingNote(discussion)?.author?.bot === true;

	return (
		<li className={styles.thread}>
			<div className={styles.threadHead}>
				<span className={styles.threadFile}>{where ?? "General note"}</span>

				<Tag tone={discussion.resolved ? "success" : "warning"}>
					{discussion.resolved ? "resolved" : "unresolved"}
				</Tag>

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
					disabled={review.busy}
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
						disabled={review.busy}
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
						void review.propose({
							project: mr.project,
							iid: mr.iid,
							action: "reply",
							discussionId: discussion.id,
							body: reply,
						});
						setReply(undefined);
					}}
					onCancel={() => {
						setReply(undefined);
					}}
				/>
			)}
		</li>
	);
};

interface Props {
	readonly mr: MergeRequestDetail;
	readonly discussions: readonly Discussion[];
	readonly review: ReviewState;
}

/** Every thread on the merge request, and the composer for a new one. */
export const MrDiscussions = ({
	mr,
	discussions,
	review,
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
		if (filter === "unresolved")
			return !discussion.resolved && discussion.resolvable;
		if (filter === "findings") return isFinding(discussion);

		return true;
	});

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
					disabled={review.busy}
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
						void review.propose({
							project: mr.project,
							iid: mr.iid,
							action: "comment",
							body: comment,
						});
						setComment(undefined);
					}}
					onCancel={() => {
						setComment(undefined);
					}}
				/>
			)}

			{shown.length === 0 ? (
				<span className={styles.caption}>Nothing here.</span>
			) : (
				<ul className={styles.list} data-layout="list">
					{shown.map((discussion) => (
						<Thread
							key={discussion.id}
							discussion={discussion}
							mr={mr}
							review={review}
						/>
					))}
				</ul>
			)}
		</Section>
	);
};

/**
 * The Diff tab: every changed file, with the change under it.
 *
 * GitLab answers a diff as patch text; the diff surface renders the prior and
 * the new text, and `patchToHunk` is the one place that reads one into the
 * other. A file whose patch the server did not send — a binary change, or a
 * facet that answered with statistics only — keeps its header and says so,
 * rather than showing an empty box.
 */

import {
	DiffBlock,
	type DiffBlockLabels,
	Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReactNode } from "react";
import type { DiffFile } from "../../shared/panel";
import { patchToHunks } from "../diff";
import * as styles from "../styles/styles.css";
import { Section } from "./blocks";

/** Chrome for the diff surface; one identity for the whole panel. */
const DIFF_LABELS: DiffBlockLabels = {
	codeLabel: "Diff",
	wrapLabel: "Wrap lines",
	unwrapLabel: "Keep columns",
	copy: "Copy",
	copied: "Copied",
	collapseAria: "Collapse the diff",
	expandAria: (hidden) => `Show ${hidden} more lines`,
	collapse: "Collapse",
	expand: (hidden) => `Show ${hidden} more lines`,
};

/** One changed file: where it changed, by how much, and the change itself. */
const FileDiff = ({ file }: { file: DiffFile }) => {
	const hunks = patchToHunks(file);

	return (
		<li className={styles.item}>
			<div className={styles.diffHead}>
				<span className={styles.diffPath}>{file.path}</span>

				{file.newFile ? <Tag tone="success">new</Tag> : null}
				{file.deletedFile ? <Tag tone="danger">deleted</Tag> : null}
				{file.renamedFile ? <Tag tone="neutral">renamed</Tag> : null}

				<span className={styles.added}>{`+${file.added}`}</span>
				<span className={styles.removed}>{`−${file.removed}`}</span>
			</div>

			{hunks.length === 0 ? (
				<span className={styles.caption}>
					GitLab sent no patch text for this file.
				</span>
			) : (
				<DiffBlock diffs={hunks} labels={DIFF_LABELS} />
			)}
		</li>
	);
};

/** Every file the merge request changes. */
export const MrDiff = ({
	diffs,
}: {
	diffs: readonly DiffFile[];
}): ReactNode => {
	if (diffs.length === 0)
		return (
			<Section title="Diff">
				<span className={styles.caption}>
					This merge request changes no files, or GitLab sent no diff for it.
				</span>
			</Section>
		);

	return (
		<Section title={`Files (${diffs.length})`}>
			<ul className={styles.list} data-layout="list">
				{diffs.map((file) => (
					<FileDiff key={`${file.oldPath ?? ""}->${file.path}`} file={file} />
				))}
			</ul>
		</Section>
	);
};

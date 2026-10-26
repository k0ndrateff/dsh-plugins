/**
 * The GitLab panel: one merge request, in four sections.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to show arrives in the
 * tab's navigation parameters, the merge request comes through the host's
 * `/dsh-gitlab` route — only the host half holds the MCP connection — and the
 * loading, failing, retrying and writing belong to `dsh-integration-ui`.
 *
 * The sections are the workflow rather than a taxonomy: what the merge request
 * is, what it changes, what reviewers asked for, and whether the pipeline agrees.
 * The diff, the discussions and the pipeline are large enough that putting them
 * all on one scroll would bury whichever one the reader came for.
 */

import {
	type SegmentedTab,
	SegmentedTabs,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
	createPanelBody,
	createPanelTitle,
	type PanelProvider,
	type PanelViewProps,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	asMergeRequestPanel,
	asPanelTarget,
	type MergeRequestPanel,
	type PanelTarget,
} from "../../shared/panel";
import { MrDiff } from "../components/mr-diff";
import { MrDiscussions } from "../components/mr-discussions";
import { MrOverview } from "../components/mr-overview";
import { MrPipeline } from "../components/mr-pipeline";
import { hostApi } from "../host-api";
import * as styles from "../styles/styles.css";
import { useReview } from "./review";

/** The four sections of the panel. */
type Tab = "overview" | "diff" | "discussions" | "pipeline";

const TABS: readonly [SegmentedTab<Tab>, ...SegmentedTab<Tab>[]] = [
	{
		value: "overview",
		label: "Overview",
		id: "gitlab-tab-overview",
		panelId: "gitlab-panel-overview",
	},
	{
		value: "diff",
		label: "Diff",
		id: "gitlab-tab-diff",
		panelId: "gitlab-panel-diff",
	},
	{
		value: "discussions",
		label: "Discussions",
		id: "gitlab-tab-discussions",
		panelId: "gitlab-panel-discussions",
	},
	{
		value: "pipeline",
		label: "Pipeline",
		id: "gitlab-tab-pipeline",
		panelId: "gitlab-panel-pipeline",
	},
];

/** One merge request: its heading, its sections, and the pending confirmation. */
const MrView = ({
	data,
	params,
	actions,
}: PanelViewProps<MergeRequestPanel, PanelTarget>): ReactNode => {
	const wanted = params.tab ?? "overview";
	const [tab, setTab] = useState<Tab>(wanted);
	const review = useReview();
	const mr = data.mr;
	const active = TABS.find((candidate) => candidate.value === tab);

	// A card opens the panel on the section it is about — a finding lands on the
	// discussions, a failed job on the pipeline — so the section follows what the
	// panel was last navigated to rather than staying where the reader left it.
	useEffect(() => {
		setTab(wanted);
	}, [params.project, params.iid, wanted]);

	return (
		<>
			<header className={styles.mrHead}>
				<div className={styles.panelTitleRow}>
					<span className={styles.panelKey}>{`${mr.project}!${mr.iid}`}</span>

					{mr.url === undefined ? null : (
						<a
							className={styles.link}
							href={mr.url}
							target="_blank"
							rel="noreferrer"
						>
							Open in GitLab
						</a>
					)}
				</div>

				<h2 className={styles.panelSummary}>{mr.title}</h2>

				{data.truncated === true ? (
					<span className={styles.caption}>
						GitLab had more diff or discussion pages than this panel read.
					</span>
				) : null}
			</header>

			<div className={styles.tabs}>
				<SegmentedTabs
					items={TABS}
					value={tab}
					onChange={setTab}
					label="Merge request sections"
				/>
			</div>

			<div id={active?.panelId} role="tabpanel" aria-labelledby={active?.id}>
				{tab === "overview" ? (
					<MrOverview
						mr={mr}
						review={review}
						actions={actions}
						approvals={data.approvals}
						approvalsError={data.approvalsError}
					/>
				) : null}
				{tab === "diff" ? <MrDiff diffs={data.diffs} /> : null}
				{tab === "discussions" ? (
					<MrDiscussions
						mr={mr}
						discussions={data.discussions}
						review={review}
						actions={actions}
						focusDiscussionId={params.discussionId}
					/>
				) : null}
				{tab === "pipeline" ? <MrPipeline target={params} /> : null}
			</div>
		</>
	);
};

/** Everything the shared panel needs from this plugin. */
const provider: PanelProvider<MergeRequestPanel, PanelTarget> = {
	emptyMessage: "This panel was opened without a merge request.",
	parseParams: (value) => asPanelTarget(value),
	identity: (target) =>
		`${target.project}!${target.iid}#${target.tab ?? ""}#${target.discussionId ?? ""}#${target.jobId ?? ""}`,
	title: (target) => `!${target.iid}`,
	fetch: async (target, signal) =>
		await hostApi.mergeRequest(target.project, target.iid, signal),
	parse: (value) => asMergeRequestPanel(value),
	view: (props) => <MrView {...props} />,
};

/** The panel's body seat. */
export const GitLabPanel = createPanelBody(provider);

/** The panel's title seat. */
export const GitLabPanelTitle = createPanelTitle(provider);

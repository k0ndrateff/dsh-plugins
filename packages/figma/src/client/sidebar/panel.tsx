/**
 * The Figma panel: one node, in three sections.
 *
 * The body is a right-Sidebar tab of this plugin's own kind, so it renders
 * inside the harness's panel and follows its theme. What to show arrives in the
 * tab's navigation parameters, the node comes through the host's `/dsh-figma`
 * route — only the host half holds the MCP connection — and the loading,
 * failing, retrying and writing belong to `dsh-integration-ui`.
 *
 * The sections are the three questions a developer asks about a frame: what it
 * is, which tokens it uses, and what it maps to in the codebase. The picture
 * leads the first one, because it is what the reader came for.
 */

import {
	Button,
	type SegmentedTab,
	SegmentedTabs,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
	Chip,
	createPanelBody,
	createPanelTitle,
	Facts,
	type PanelProvider,
	type PanelViewProps,
} from "dsh-integration-ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	asNodePanel,
	asPanelTarget,
	type FigmaNode,
	type NodePanel,
	type PanelSection,
	type PanelTarget,
} from "../../shared/panel";
import { FrameImage } from "../components/frame-image";
import { hostApi } from "../host-api";
import { countText } from "../plural";
import { openPanel } from "../sidebar/open";
import * as styles from "../styles/styles.css";

/** The three sections of the panel. */
const TABS: readonly [
	SegmentedTab<PanelSection>,
	...SegmentedTab<PanelSection>[],
] = [
	{
		value: "frame",
		label: "Frame",
		id: "figma-tab-frame",
		panelId: "figma-panel-frame",
	},
	{
		value: "tokens",
		label: "Tokens",
		id: "figma-tab-tokens",
		panelId: "figma-panel-tokens",
	},
	{
		value: "code",
		label: "Code Connect",
		id: "figma-tab-code",
		panelId: "figma-panel-code",
	},
];

/**
 * How many variables the node uses, without passing a cut list off as the total.
 * @param panel - the node's document.
 */
const variablesFact = (panel: NodePanel): string | number => {
	if (panel.tokensError !== undefined) return "could not be read";
	if (panel.tokensTruncated)
		return `${panel.tokens.length} of ${panel.tokenTotal}`;

	return panel.tokenTotal;
};

/** What Code Connect says, as a count when there is more than one mapping. */
const mappingsFact = (panel: NodePanel): string => {
	if (panel.mappingsError !== undefined) return "could not be read";
	if (panel.mappings.length === 0) return "none";
	if (panel.mappings.length === 1)
		return panel.mappings[0]?.component ?? "none";

	return countText(panel.mappings.length, "mapping");
};

/** Re-open the same node and section; the shared panel reads it again. */
const retrySection = (panel: NodePanel, section: PanelSection): void => {
	openPanel({ node: panel.node.id, section });
};

/** The picture, the node's numbers, and its structure. */
const FrameSection = ({ panel }: { panel: NodePanel }): ReactNode => {
	const node = panel.node;

	return (
		<>
			<FrameImage src={panel.screenshot} alt={`${node.name} in Figma`} />

			<Facts
				items={[
					{ label: "Type", value: node.type },
					{ label: "Size", value: `${node.width}×${node.height}` },
					{
						label: "Position",
						value:
							node.x === undefined || node.y === undefined
								? undefined
								: `${node.x}, ${node.y}`,
					},
					{ label: "Variables", value: variablesFact(panel) },
					{ label: "Code Connect", value: mappingsFact(panel) },
				]}
			/>

			{panel.children.length === 0 ? null : (
				<section className={styles.panelSection}>
					<h3 className={styles.panelSectionTitle}>Layers</h3>

					<span className={styles.caption}>
						Direct children only — open a layer to read what is inside it.
					</span>

					{panel.children.map((child: FigmaNode) => (
						<button
							key={child.id}
							type="button"
							className={styles.layer}
							onClick={() => {
								openPanel({ node: child.id });
							}}
						>
							<span className={styles.layerName}>{child.name}</span>

							<span className={styles.layerMeta}>
								{`${child.type} · ${child.width}×${child.height}`}
							</span>
						</button>
					))}

					{panel.childrenTruncated ? (
						<span className={styles.caption}>
							…and {panel.childTotal - panel.children.length} more layers than
							this panel lists
						</span>
					) : null}
				</section>
			)}
		</>
	);
};

/** The variables the node uses, or why they could not be read. */
const TokensSection = ({ panel }: { panel: NodePanel }): ReactNode => {
	if (panel.tokensError !== undefined)
		return (
			<>
				<p className={styles.error} role="alert">
					{`The variables could not be read — ${panel.tokensError}`}
				</p>

				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						retrySection(panel, "tokens");
					}}
				>
					Try again
				</Button>
			</>
		);

	if (panel.tokens.length === 0)
		return <p className={styles.caption}>This node uses no variables.</p>;

	return (
		<>
			{panel.tokens.map((token) => (
				<div key={token.name} className={styles.token}>
					<span className={styles.tokenName}>{token.name}</span>
					<span className={styles.tokenValue}>{token.value}</span>
				</div>
			))}

			{panel.tokensTruncated ? (
				<p className={styles.caption}>
					…and {panel.tokenTotal - panel.tokens.length} more variables than this
					panel lists
				</p>
			) : null}
		</>
	);
};

/** What the node maps to in the codebase, or why it could not be read. */
const CodeSection = ({ panel }: { panel: NodePanel }): ReactNode => {
	if (panel.mappingsError !== undefined)
		return (
			<>
				<p className={styles.error} role="alert">
					{`The Code Connect mappings could not be read — ${panel.mappingsError}`}
				</p>

				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						retrySection(panel, "code");
					}}
				>
					Try again
				</Button>
			</>
		);

	if (panel.mappings.length === 0)
		return (
			<p className={styles.caption}>
				No Code Connect mapping names this node. Map it in the Figma desktop
				app, or from the codebase with the Code Connect CLI.
			</p>
		);

	return (
		<>
			{panel.mappings.map((mapping) => (
				<div
					key={`${mapping.nodeId}-${mapping.source}`}
					className={styles.mapping}
				>
					<span className={styles.mappingComponent}>{mapping.component}</span>
					<span className={styles.mappingSource}>{mapping.source}</span>
				</div>
			))}
		</>
	);
};

/** One node: its heading, its sections, and the section it was opened on. */
const NodeView = ({
	data,
	params,
}: PanelViewProps<NodePanel, PanelTarget>): ReactNode => {
	const wanted = params.section ?? "frame";
	const [section, setSection] = useState<PanelSection>(wanted);
	const node = data.node;
	const active = TABS.find((candidate) => candidate.value === section);

	// A card opens the panel on the section it is about, so the section follows
	// what the panel was last navigated to rather than staying where the reader
	// left it.
	useEffect(() => {
		setSection(wanted);
	}, [params.node, wanted]);

	return (
		<>
			<header className={styles.panelHead}>
				<div className={styles.panelTitleRow}>
					<span className={styles.panelKey}>{node.id}</span>

					<Chip tone="neutral" value={node.type} />
				</div>

				<h2 className={styles.panelSummary}>{node.name}</h2>
			</header>

			<div className={styles.tabs}>
				<SegmentedTabs
					items={TABS}
					value={section}
					onChange={setSection}
					label="Figma sections"
				/>
			</div>

			<div id={active?.panelId} role="tabpanel" aria-labelledby={active?.id}>
				{section === "frame" ? <FrameSection panel={data} /> : null}
				{section === "tokens" ? <TokensSection panel={data} /> : null}
				{section === "code" ? <CodeSection panel={data} /> : null}
			</div>
		</>
	);
};

/** Everything the shared panel needs from this plugin. */
const provider: PanelProvider<NodePanel, PanelTarget> = {
	emptyMessage:
		"This panel was opened without a Figma node. Ask the agent to show one, or open it from a card.",
	parseParams: (value) => asPanelTarget(value),
	identity: (target) => `${target.node ?? "selection"}#${target.section ?? ""}`,
	title: (target) => target.node ?? "Figma",
	fetch: async (target, signal) => await hostApi.node(target, signal),
	parse: (value) => asNodePanel(value),
	view: (props) => <NodeView {...props} />,
};

/** The panel's body seat. */
export const FigmaPanel = createPanelBody(provider);

/** The panel's title seat. */
export const FigmaPanelTitle = createPanelTitle(provider);

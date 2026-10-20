/**
 * How one Figma card draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; this says
 * what the heading counts and which row goes in the list. A Figma card holds
 * exactly one node, because one call shows one frame: the card is the record of
 * what was shown, and the panel is where it is actually looked at.
 */

import type { CardProvider } from "dsh-integration-ui";
import type { FigmaPresentation } from "../../shared/meta";
import { FigmaNodeItem } from "./node-item";

/** The Figma card, as the shared tail draws it. */
export const figmaCard: CardProvider<FigmaPresentation> = {
	callId: (presentation) => presentation.callId,
	title: (presentation) => presentation.node.name,
	count: (presentation) =>
		`${presentation.node.type} · ${presentation.node.width}×${presentation.node.height}`,
	length: () => 1,
	layout: (presentation) => presentation.layout,
	items: (presentation) => (
		<FigmaNodeItem key={presentation.node.id} node={presentation.node} />
	),
};

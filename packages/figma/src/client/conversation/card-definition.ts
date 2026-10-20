/**
 * The turn-scoped card behind `figma_present`.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and the
 * state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is Figma's is the payload narrowing and how the card
 * draws itself. Nothing extra is written to the session: the card is narrowed
 * from the tool result's persisted `presentationMeta`, which means Session-log
 * replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import { asFigmaPresentation, type FigmaPresentation } from "../../shared/meta";
import { figmaCard } from "../components/presentation-card";

/** The wire name whose settled result carries one card. */
export const FIGMA_PRESENT_TOOL = "figma_present";

/** The Turn-data key the tail reads. */
export const FIGMA_TURN_DATA_KEY = "figma-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Cards `figma_present` asked to show in this Turn, in call order. */
		"figma-presented": PresentationTurnData<FigmaPresentation>;
	}
}

/** The Figma card, as this plugin registers and renders it. */
export const figmaPresentation = createPresentationType<
	FigmaPresentation,
	"figma-presented"
>({
	turnDataKey: FIGMA_TURN_DATA_KEY,
	toolName: FIGMA_PRESENT_TOOL,
	parse: asFigmaPresentation,
	card: figmaCard,
});

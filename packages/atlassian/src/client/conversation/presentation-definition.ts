/**
 * The turn-scoped card behind `atlassian_present`.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and
 * the state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is Atlassian's is the payload narrowing and how the
 * card draws itself. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, which means
 * Session-log replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import {
	type AtlassianPresentation,
	asPresentation,
} from "../../shared/presentation";
import { atlassianCard } from "../components/presentation-card";

/** The wire name whose settled result carries one card. */
export const PRESENT_TOOL_NAME = "atlassian_present";

/** The Turn-data key the tail reads. */
export const PRESENTATION_TURN_DATA_KEY = "atlassian-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Cards `atlassian_present` asked to show in this Turn, in call order. */
		"atlassian-presented": PresentationTurnData<AtlassianPresentation>;
	}
}

/** The Atlassian card, as this plugin registers and renders it. */
export const atlassianPresentation = createPresentationType<
	AtlassianPresentation,
	"atlassian-presented"
>({
	turnDataKey: PRESENTATION_TURN_DATA_KEY,
	toolName: PRESENT_TOOL_NAME,
	parse: asPresentation,
	card: atlassianCard,
});

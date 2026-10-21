/**
 * The turn-scoped card behind the `correlate` tool.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and the
 * state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is the chain's is the payload narrowing and how the
 * card draws itself. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, so Session-log
 * replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import { asChainReport, type ChainReport } from "../../shared/meta";
import { chainCard } from "../components/chain-card";

/** The wire name whose settled result carries one card. */
export const CHAIN_TOOL_NAME = "correlate";

/** The Turn-data key the tail reads. */
export const CHAIN_TURN_DATA_KEY = "correlation-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Chains `correlate` walked in this Turn, in call order. */
		"correlation-presented": PresentationTurnData<ChainReport>;
	}
}

/** The chain card, as this plugin registers and renders it. */
export const correlationPresentation = createPresentationType<
	ChainReport,
	"correlation-presented"
>({
	turnDataKey: CHAIN_TURN_DATA_KEY,
	toolName: CHAIN_TOOL_NAME,
	parse: asChainReport,
	card: chainCard,
});

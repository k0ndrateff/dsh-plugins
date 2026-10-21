/**
 * The turn-scoped card behind `checks`.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and
 * the state machine that collects runs — belongs to `dsh-integration-ui`; what
 * is devkit's is the payload narrowing, how the card draws itself, and the rule
 * that one Turn keeps the newest run: a project has one state, and a turn that
 * ran the checks three times was looking for that state, not for three reports. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, which means
 * Session-log replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import { asChecksCard, type ChecksCard } from "../../shared/checks";
import { checksCard } from "../components/checks-card";

/** The wire name whose settled result carries one run. */
export const CHECKS_TOOL_NAME = "checks";

/** The Turn-data key the tail reads. */
export const CHECKS_TURN_DATA_KEY = "devkit-checks";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Runs `checks` reported in this Turn, in call order. */
		"devkit-checks": PresentationTurnData<ChecksCard>;
	}
}

/** The checks card, as this plugin registers and renders it. */
export const checksPresentation = createPresentationType<
	ChecksCard,
	"devkit-checks"
>({
	turnDataKey: CHECKS_TURN_DATA_KEY,
	toolName: CHECKS_TOOL_NAME,
	keep: "last",
	parse: asChecksCard,
	card: checksCard,
});

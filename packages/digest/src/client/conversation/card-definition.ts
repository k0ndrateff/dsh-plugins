/**
 * The turn-scoped card behind the `digest` tool.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and
 * the state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is the digest's is the payload narrowing and how
 * the card draws itself. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, so Session-log
 * replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import { asDigestReport, type DigestReport } from "../../shared/digest";
import { digestCard } from "../components/digest-card";

/** The wire name whose settled result carries one card. */
export const DIGEST_TOOL_NAME = "digest";

/** The Turn-data key the tail reads. */
export const DIGEST_TURN_DATA_KEY = "digest-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Digests `digest` assembled in this Turn, in call order. */
		"digest-presented": PresentationTurnData<DigestReport>;
	}
}

/** The digest card, as this plugin registers and renders it. */
export const digestPresentation = createPresentationType<
	DigestReport,
	"digest-presented"
>({
	turnDataKey: DIGEST_TURN_DATA_KEY,
	toolName: DIGEST_TOOL_NAME,
	parse: asDigestReport,
	card: digestCard,
});

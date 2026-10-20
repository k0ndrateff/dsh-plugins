/**
 * The turn-scoped card behind `sentry_present`.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and
 * the state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is Sentry's is the payload narrowing and how the
 * card draws itself. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, which means
 * Session-log replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import {
	asSentryPresentation,
	type SentryPresentation,
} from "../../shared/meta";
import { sentryCard } from "../components/presentation-card";

/** The wire name whose settled result carries one card. */
export const SENTRY_TOOL_NAME = "sentry_present";

/** The Turn-data key the tail reads. */
export const SENTRY_TURN_DATA_KEY = "sentry-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Cards `sentry_present` asked to show in this Turn, in call order. */
		"sentry-presented": PresentationTurnData<SentryPresentation>;
	}
}

/** The Sentry card, as this plugin registers and renders it. */
export const sentryPresentation = createPresentationType<
	SentryPresentation,
	"sentry-presented"
>({
	turnDataKey: SENTRY_TURN_DATA_KEY,
	toolName: SENTRY_TOOL_NAME,
	parse: asSentryPresentation,
	card: sentryCard,
});

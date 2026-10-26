/**
 * The turn-scoped card behind `gitlab_present`.
 *
 * The card itself — its wire name, the Turn-data key it publishes under, and
 * the state machine that collects one card per settled call — belongs to
 * `dsh-integration-ui`; what is GitLab's is the payload narrowing and how the
 * card draws itself. Nothing extra is written to the session: the card is
 * narrowed from the tool result's persisted `presentationMeta`, which means
 * Session-log replay reproduces it exactly.
 */

import {
	createPresentationType,
	type PresentationTurnData,
} from "dsh-integration-ui";
import {
	asGitLabPresentation,
	type GitLabPresentation,
} from "../../shared/meta";
import { GITLAB_PRESENT_TOOL, GITLAB_REVIEW_TOOL } from "../../shared/tools";
import { gitlabCard } from "../components/presentation-card";

export { GITLAB_PRESENT_TOOL, GITLAB_REVIEW_TOOL };

/** The Turn-data key the tail reads. */
export const GITLAB_TURN_DATA_KEY = "gitlab-presented";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Cards `gitlab_present` asked to show in this Turn, in call order. */
		"gitlab-presented": PresentationTurnData<GitLabPresentation>;
	}
}

/** The GitLab card, as this plugin registers and renders it. */
export const gitlabPresentation = createPresentationType<
	GitLabPresentation,
	"gitlab-presented"
>({
	turnDataKey: GITLAB_TURN_DATA_KEY,
	toolName: GITLAB_PRESENT_TOOL,
	parse: asGitLabPresentation,
	card: gitlabCard,
});

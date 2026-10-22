/**
 * Telling the agent what the person did to the page while it was working.
 *
 * The agent drives one browser and a person watches the same one, so a click
 * from the panel can move the page under a plan the agent has already made: the
 * refs it took five seconds ago are gone, the layout it measured is not the
 * layout any more, and nothing in its own history says why. This is where that
 * gap is closed — the note becomes the first block of the next tool result,
 * whoever's call it is.
 *
 * `finalizeContent` rather than a field of the answer: it runs after the tool's
 * own renderer, it runs for failures too (which is exactly when "the page moved"
 * explains the failure), and it needs no change to five output schemas.
 */

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { sessionNameOf } from "../session";
import type { StreamHubs } from "../stream/hubs";

/**
 * Wrap one tool so its result says what the person did since the last call.
 * @param tool - the tool as it was written.
 * @param hubs - where the person's acts are waiting, if there are any.
 * @returns the same tool, with the note put in front of its content.
 */
export const withHumanNotice = (
	tool: ToolDefinition,
	hubs: StreamHubs,
): ToolDefinition => ({
	...tool,
	finalizeContent: (exec, result) => {
		const note = hubs.takeNote(sessionNameOf(exec.agent?.session.id));

		return note === undefined
			? undefined
			: [{ type: "text", text: note }, ...result.content];
	},
});

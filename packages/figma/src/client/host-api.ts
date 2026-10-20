/**
 * The browser half's channel to the host half.
 *
 * Both run on the same loopback origin, so the settings card and the side panel
 * reach the host through the named route `/dsh-figma` with ordinary same-origin
 * requests. The transport — JSON in both directions, `{ error }` turned back
 * into a message — belongs to `dsh-integration-ui`; this is the list of calls
 * Figma actually makes. Nothing travels the other way: the Dev Mode server takes
 * no credential, so there is nothing for the user to type.
 */

import { createHostRequest } from "dsh-integration-ui";
import type { NodePanel, PanelTarget } from "../shared/panel";
import type { FigmaStatus } from "../shared/status";

const request = createHostRequest("/dsh-figma");

/** One panel target as the route spells it. */
const queryOf = (target: PanelTarget): string => {
	const query = new URLSearchParams();

	if (target.node !== undefined) query.set("node", target.node);
	if (target.section !== undefined) query.set("section", target.section);

	const text = query.toString();

	return text === "" ? "" : `?${text}`;
};

export const hostApi = {
	/** Read the current connection state. */
	status: async (): Promise<FigmaStatus> => {
		return await request("/status", "GET");
	},

	/** Disconnect: withdraw the published tools until the next check. */
	logout: async (): Promise<FigmaStatus> => {
		return await request("/logout", "POST");
	},

	/** Reach the Dev Mode server again and re-publish its tools. */
	sync: async (): Promise<FigmaStatus> => {
		return await request("/sync", "POST");
	},

	/** Everything the panel shows for one node. */
	node: async (
		target: PanelTarget,
		signal?: AbortSignal,
	): Promise<NodePanel> => {
		return await request(`/node${queryOf(target)}`, "GET", undefined, signal);
	},
};

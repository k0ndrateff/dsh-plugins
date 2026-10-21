/**
 * The Figma settings card.
 *
 * It is the only place a user has to go to connect, and connecting here means
 * starting the desktop app: the Dev Mode MCP server lives inside it and takes no
 * credential, so the card reports what the connection is doing rather than asking
 * for anything. The card itself belongs to `dsh-integration-ui`, which owns the
 * state, the buttons and the failure it shows; what is Figma's is its copy, the
 * switch it names, and the tab it sits under.
 */

import { createSettingsSection, type FactItem } from "dsh-integration-ui";
import type { FigmaStatus } from "../../shared/status";
import { hostApi } from "../host-api";

/** What the user has to turn on when the server does not answer. */
const HOW_TO_START =
	"Start the Figma desktop app and turn on “Enable Dev Mode MCP Server” in its preferences.";

/** The endpoint the panel reads, or what to do instead of reading it. */
const details = (status: FigmaStatus): readonly FactItem[] => [
	{
		label: "Dev Mode MCP",
		value: status.connected ? status.endpoint : HOW_TO_START,
	},
];

/** The Figma settings card. */
export const FigmaSection = createSettingsSection<FigmaStatus>({
	title: "Figma",
	blurb:
		"Frames, variables and Code Connect, through the Dev Mode MCP server in the Figma desktop app.",
	checking: "Checking the Figma Dev Mode MCP server…",
	unreachable: "The Figma host half is not reachable.",
	credentials: "none",
	syncLabel: "Check again",
	api: hostApi,
	details,
});

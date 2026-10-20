/**
 * The provider profile this plugin hands to the MCP bridge.
 *
 * A profile carries every provider-specific fact the OAuth library is not
 * allowed to know. This one has no `oauth` block, and that absence is the whole
 * design: the Dev Mode server answers whoever is on the machine, so the bridge
 * builds a transport with no `authProvider` and the plugin stores no credential.
 */

import { DEFAULT_INSTANCE, type ProviderProfile } from "dsh-mcp-oauth";
import { type FigmaConfig, PLUGIN_NAME } from "./config";

/** The prefix every tool of this server is published under: `mcp__figma__`. */
const TOOL_NAMESPACE = "figma";

/**
 * Build the profile for one plugin instance.
 * @param config - the resolved endpoint and debug flag.
 */
export const profileOf = (config: FigmaConfig): ProviderProfile => ({
	scope: PLUGIN_NAME,
	label: "Figma",
	instance: DEFAULT_INSTANCE,
	endpoint: config.endpoint,
	toolNamespace: TOOL_NAMESPACE,
	debug: config.debug,
});

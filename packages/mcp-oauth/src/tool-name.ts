/**
 * The harness's public tool names.
 *
 * A published MCP tool is renamed into the harness's namespace, which is capped
 * at 64 characters. Both halves of a plugin key their UI by the result — the
 * host publishes under it and the browser half claims it — so the rule lives in
 * exactly one place, bundled into each half rather than shared at runtime, and
 * the two can never disagree.
 */

/** The harness caps a tool name at this many characters. */
const MAX_TOOL_NAME = 64;

/** The prefix every published tool of one namespace carries. */
export function toolPrefix(namespace: string): string {
	return `mcp__${namespace}__`;
}

/**
 * The public harness tool name for one server tool.
 *
 * The server's own spelling is kept whenever it fits, because that is what
 * makes a plugin's keyed tool views line up; a name that does not fit gets a
 * digest appended, so two long names can never collapse into one.
 * @param serverTool - the tool name as the server spells it.
 * @param namespace - the plugin's namespace ("atlassian").
 */
export function publicToolName(serverTool: string, namespace: string): string {
	const cleaned = serverTool.replace(/[^A-Za-z0-9_-]/gu, "_") || "tool";
	const full = `${toolPrefix(namespace)}${cleaned}`;

	if (full.length <= MAX_TOOL_NAME) return full;

	const digest = digestOf(serverTool);

	return `${full.slice(0, MAX_TOOL_NAME - digest.length - 1)}_${digest}`;
}

/**
 * A deterministic 12-hex-character digest of a string.
 *
 * Disambiguating two long tool names needs no cryptography, only a hash that
 * runs identically in Node and in the browser.
 */
function digestOf(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;

	for (let index = 0; index < input.length; index += 1) {
		hash = ((hash ^ BigInt(input.charCodeAt(index))) * prime) & mask;
	}

	return hash.toString(16).padStart(16, "0").slice(0, 12);
}

/**
 * OAuth for MCP servers, and the bridge that speaks to them.
 *
 * The library owns everything a provider would otherwise write again: RFC 9728
 * and 8414 discovery, RFC 7591 dynamic client registration, PKCE over a loopback
 * redirect, token lifetime with cross-process refresh, and the MCP connection
 * whose tokens keep changing. A plugin supplies a {@link ProviderProfile} and a
 * {@link GrantStore} key, and nothing else about OAuth.
 *
 * The harness itself has no OAuth for MCP: its stock client takes a static
 * `Authorization` header from configuration. This is the missing half.
 */

export { type McpBridgeOptions, McpOAuthBridge } from "./bridge";
export { openBrowser } from "./browser";
export {
	PORT_ATTEMPTS,
	REFRESH_MARGIN_MS,
	REQUEST_TIMEOUT_MS,
	SIGN_IN_TIMEOUT_MS,
} from "./config";
export { discover } from "./discovery";
export { AuthorizationFlow } from "./flow";
export {
	Grant,
	type GrantExtra,
	GrantStore,
	type SignedInGrant,
} from "./grant";
export { type JsonValue, jsonSafe } from "./json";
export { errorText, type Logger, loggerOf } from "./log";
export { LoopbackListener } from "./loopback";
export {
	asRecord,
	mcpJson,
	mcpText,
	pickNumber,
	pickString,
} from "./payload";
export { credentialKeyFor, type ProviderProfile } from "./provider";
export { OAuthServer } from "./server";
export { publicToolName, toolPrefix } from "./tool-name";

/**
 * OAuth for MCP servers, and the bridge that speaks to them.
 *
 * The library owns everything a provider would otherwise write again: RFC 9728
 * and 8414 discovery, RFC 7591 dynamic client registration, PKCE over a loopback
 * redirect, token lifetime with cross-process refresh, and the MCP connection
 * whose tokens keep changing. A plugin supplies a {@link ProviderProfile} and a
 * {@link GrantStore} key, and nothing else about OAuth.
 *
 * One profile is one account. A plugin that holds several accounts of the same
 * provider builds one profile per account, and {@link credentialKeyOf} gives
 * each its own record, so a work GitLab and a personal one never share a token.
 * A profile with no OAuth facts is a server that needs no credentials at all,
 * and the same bridge reaches it.
 *
 * The harness itself has no OAuth for MCP: its stock client takes a static
 * `Authorization` header from configuration. This is the missing half.
 */

export {
	credentialKeyFor,
	DEFAULT_INSTANCE,
	instanceOfKey,
	instancesOf,
} from "./account";
export { McpBridge, type McpBridgeOptions } from "./bridge";
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
	mcpFailure,
	mcpJson,
	mcpText,
	pickNumber,
	pickString,
} from "./payload";
export {
	accountLabel,
	credentialKeyOf,
	type NoAuthProviderProfile,
	needsOAuth,
	type OAuthProfile,
	type OAuthProviderProfile,
	type ProviderProfile,
} from "./provider";
export {
	authMethodOf,
	chooseTokenAuthMethod,
	OAuthServer,
	type RegisteredClient,
	type TokenAuthMethod,
} from "./server";
export { publicToolName, toolPrefix } from "./tool-name";

/**
 * The host-half shell every integration plugin shares.
 *
 * A plugin's host half owns what is its provider's — the profile, the tools,
 * the panel data, the account facts — while this library owns the shell around
 * them: normalizing the endpoint patch, holding the sign-in state, answering
 * the settings route, running the slash command, and reading a provider's
 * markdown the way a reader means it. `dsh-mcp-oauth` owns the OAuth flow and
 * the MCP connection underneath both.
 */

export {
	type AuthDeps,
	type AuthSpec,
	IntegrationAuth,
	type IntegrationAuthFace,
	type StatusExtras,
} from "./auth";
export {
	type CommandResult,
	type CommandSpec,
	createIntegrationCommand,
} from "./command";
export {
	type ConfigDefaults,
	type ConfigInput,
	type EndpointConfig,
	resolveEndpointConfig,
} from "./config";
export {
	CORRELATION_SOURCES,
	type CorrelationFact,
	type CorrelationKind,
	type CorrelationRef,
	type CorrelationSource,
	type CorrelationSourceEntry,
	CorrelationSources,
} from "./correlation";
export {
	DIGEST_SOURCES,
	type DigestBlockEntry,
	type DigestBlockSpec,
	type DigestItem,
	type DigestLoadOptions,
	type DigestSource,
	DigestSources,
} from "./digest";
export type { AccountFacts, FactsReader } from "./facts";
export { stripHtmlComments } from "./markdown";
export {
	BadRequest,
	clientRequestRefusal,
	createIntegrationRoute,
	type MountSpec,
	mountIntegrationRoute,
	type RouteBody,
	type RouteContext,
	type RouteHandler,
	type RouteHost,
	type RouteSpec,
} from "./route";
export { RuntimeState } from "./state";
export {
	CLIENT_REQUEST_HEADER,
	CLIENT_REQUEST_VALUE,
	type IntegrationStatus,
	type StatusNotice,
} from "./status";

/**
 * The host-half shell every integration plugin shares.
 *
 * A plugin's host half owns what is its provider's — the profile, the tools,
 * the panel data, the account facts — while this library owns the shell around
 * them: normalizing the endpoint patch, holding the sign-in state, answering
 * the settings route, and running the slash command. `dsh-mcp-oauth` owns the
 * OAuth flow and the MCP connection underneath both.
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
export type { AccountFacts, FactsReader } from "./facts";
export {
	BadRequest,
	createIntegrationRoute,
	type RouteBody,
	type RouteContext,
	type RouteHandler,
	type RouteHost,
	type RouteSpec,
} from "./route";
export { RuntimeState } from "./state";
export type { IntegrationStatus, StatusNotice } from "./status";

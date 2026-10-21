/**
 * The localhost API the browser half calls.
 *
 * The settings card and the side panel live in the page, so they need a channel
 * to the host. A named route on the harness web server is that channel, and the
 * four paths every integration answers — status, login, logout, sync — come
 * from `dsh-integration-host`. What is left here is what is Sentry's: the reads
 * and writes its side panel makes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BadRequest,
	createIntegrationRoute,
	type IntegrationAuthFace,
	type RouteHandler,
} from "dsh-integration-host";
import type { SentryStatus } from "../../shared/status";
import type { PanelApi } from "../panels/panel";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-sentry";

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly auth: IntegrationAuthFace<SentryStatus>;
	readonly panel: PanelApi;
}

/** The side panel's own paths, tried after the four shared ones. */
const panelRoutes = (panel: PanelApi): readonly RouteHandler[] => [
	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/issue` ||
			route.method !== "GET"
		)
			return false;

		const id = route.url.searchParams.get("id") ?? "";

		await route.sendData(() => panel.issue(id));

		return true;
	},

	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/me` || route.method !== "GET")
			return false;

		await route.sendData(async () => ({ reference: await panel.me() }));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/issue/status` ||
			route.method !== "POST"
		)
			return false;

		// The request is read and validated before any work starts, so a caller's
		// mistake is answered as one instead of as a bad gateway.
		const body = await route.read();
		const id = body.required("id");
		const status = body.required("status");
		const ignoreMode = body.fields?.ignoreMode;

		if (ignoreMode !== undefined && typeof ignoreMode !== "string")
			throw new BadRequest('"ignoreMode" must be a string');

		await route.sendData(() => panel.setStatus(id, status, ignoreMode));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/issue/assign` ||
			route.method !== "POST"
		)
			return false;

		const body = await route.read();
		const id = body.required("id");
		const assignedTo = body.fields?.assignedTo;

		if (assignedTo !== null && typeof assignedTo !== "string")
			throw new BadRequest('the request needs an "assignedTo" or null');

		await route.sendData(() => panel.assign(id, assignedTo));

		return true;
	},
];

/**
 * Build the request handler.
 * @param deps - the plugin's collaborators.
 */
export const createApiHandler = (
	deps: ApiDeps,
): ((request: IncomingMessage, response: ServerResponse) => Promise<void>) => {
	return createIntegrationRoute({
		prefix: ROUTE_PREFIX,
		auth: deps.auth,
		routes: panelRoutes(deps.panel),
	});
};

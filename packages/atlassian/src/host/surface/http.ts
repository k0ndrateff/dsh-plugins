/**
 * The localhost API the browser half calls.
 *
 * The settings card and the side panel live in the page, so they need a channel
 * to the host. A named route on the harness web server is that channel, and the
 * four paths every integration answers — status, login, logout, sync — come
 * from `dsh-integration-host`. What is left here is what is Atlassian's: the
 * reads and writes its side panel makes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BadRequest,
	createIntegrationRoute,
	type IntegrationAuthFace,
	type RouteHandler,
} from "dsh-integration-host";
import type { AtlassianStatus } from "../../shared/status";
import type { PanelApi } from "../panels/panel";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-atlassian";

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly auth: IntegrationAuthFace<AtlassianStatus>;
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

		const key = route.url.searchParams.get("key") ?? "";

		await route.sendData(() => panel.issue(key));

		return true;
	},

	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/page` || route.method !== "GET")
			return false;

		const id = route.url.searchParams.get("id") ?? "";

		await route.sendData(() => panel.page(id));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/people` ||
			route.method !== "GET"
		)
			return false;

		const query = route.url.searchParams.get("q") ?? "";

		await route.sendData(() => panel.people(query));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/issue/transition` ||
			route.method !== "POST"
		)
			return false;

		// The request is read and validated before any work starts, so a caller's
		// mistake is answered as one instead of as a bad gateway.
		const body = await route.read();
		const key = body.required("key");
		const transitionId = body.required("transitionId");

		await route.sendData(async () => {
			await panel.transition(key, transitionId);

			return await panel.issue(key);
		});

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/issue/assignee` ||
			route.method !== "POST"
		)
			return false;

		const body = await route.read();
		const key = body.required("key");
		const accountId = body.fields?.accountId;

		if (accountId !== null && typeof accountId !== "string")
			throw new BadRequest('the request needs an "accountId" or null');

		await route.sendData(async () => {
			await panel.assign(key, accountId);

			return await panel.issue(key);
		});

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

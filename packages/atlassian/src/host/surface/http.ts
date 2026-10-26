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
		const cloudId = route.url.searchParams.get("cloudId") ?? undefined;

		await route.sendData(() => panel.issue(key, cloudId));

		return true;
	},

	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/page` || route.method !== "GET")
			return false;

		const id = route.url.searchParams.get("id") ?? "";
		const cloudId = route.url.searchParams.get("cloudId") ?? undefined;

		await route.sendData(() => panel.page(id, cloudId));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/people` ||
			route.method !== "GET"
		)
			return false;

		const query = route.url.searchParams.get("q") ?? "";
		const cloudId = route.url.searchParams.get("cloudId") ?? undefined;

		await route.sendData(() => panel.people(query, cloudId));

		return true;
	},

	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/me` || route.method !== "GET")
			return false;

		await route.sendData(async () => ({
			person: (await panel.me()) ?? null,
		}));

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
		const cloudId = optionalString(body.fields?.cloudId, '"cloudId"');

		await route.sendData(async () => {
			await panel.transition(key, transitionId, cloudId);

			return await panel.issue(key, cloudId);
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
		const cloudId = optionalString(body.fields?.cloudId, '"cloudId"');

		if (accountId !== null && typeof accountId !== "string")
			throw new BadRequest('the request needs an "accountId" or null');

		await route.sendData(async () => {
			await panel.assign(key, accountId, cloudId);

			return await panel.issue(key, cloudId);
		});

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/site` ||
			route.method !== "POST"
		)
			return false;

		const body = await route.read();
		const cloudId = body.required("cloudId");

		await route.sendData(async () => {
			const facts = await panel.selectSite(cloudId);

			return { cloudId: facts.cloudId ?? null, siteUrl: facts.siteUrl ?? null };
		});

		return true;
	},
];

/** Read one optional string field, refusing a value of another type. */
function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value === "")
		throw new BadRequest(`${name} must be a non-empty string`);

	return value;
}

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

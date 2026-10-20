/**
 * The localhost API the browser half calls.
 *
 * The settings card and the side panel live in the page, so they need a channel
 * to the host. A named route on the harness web server is that channel, and the
 * four paths every integration answers — status, login, logout, sync — come from
 * `dsh-integration-host`. What is left here is what is Figma's: the document the
 * panel draws, and the picture it draws it with.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BadRequest,
	createIntegrationRoute,
	type IntegrationAuthFace,
	type RouteContext,
	type RouteHandler,
} from "dsh-integration-host";
import { errorText } from "dsh-mcp-oauth";
import type { PanelSection, PanelTarget } from "../../shared/panel";
import type { FigmaStatus } from "../../shared/status";
import type { PanelApi } from "../panels/panel";
import { parseNodeRef } from "../presentation/parse";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-figma";

/** The panel's three sections, as the query string spells them. */
const SECTIONS: readonly PanelSection[] = ["frame", "tokens", "code"];

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly auth: IntegrationAuthFace<FigmaStatus>;
	readonly panel: PanelApi;
}

/**
 * What the panel was asked to show.
 * @throws a bad-request failure when the query names no node, or names one in a
 *   way Figma cannot read.
 */
function targetOf(route: RouteContext): PanelTarget {
	const node = route.url.searchParams.get("node") ?? "";
	const section = route.url.searchParams.get("section") ?? "";

	if (section !== "" && !SECTIONS.includes(section as PanelSection))
		throw new BadRequest(`"${section}" is not a panel section`);

	if (node === "")
		return section === "" ? {} : { section: section as PanelSection };

	if (parseNodeRef(node) === undefined)
		throw new BadRequest(`"${node}" names no Figma node`);

	return {
		node,
		...(section === "" ? {} : { section: section as PanelSection }),
	};
}

/** One node id the picture route was asked for. */
function nodeParamOf(route: RouteContext): string {
	const node = route.url.searchParams.get("node") ?? "";
	const ref = parseNodeRef(node);

	if (ref === undefined) throw new BadRequest('the request needs a "node"');

	return ref.nodeId;
}

/** The panel's own paths, tried after the four shared ones. */
const panelRoutes = (deps: ApiDeps): readonly RouteHandler[] => [
	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/node` || route.method !== "GET")
			return false;

		// The query is read and validated before any work starts, so a caller's
		// mistake is answered as one instead of as a bad gateway.
		const target = targetOf(route);

		await route.sendData(() => deps.panel.node(target));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/screenshot` ||
			route.method !== "GET"
		)
			return false;

		const node = nodeParamOf(route);

		try {
			const shot = await deps.panel.screenshot(node);

			route.sendBytes(200, shot.contentType, shot.bytes);
		} catch (error) {
			// The page asked for a picture with an `<img>`, so a failure has to be
			// answered the same way a failed read is: as JSON, with the reason.
			route.send(502, { error: errorText(error) });
		}

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
		routes: panelRoutes(deps),
	});
};

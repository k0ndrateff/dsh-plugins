/**
 * The localhost API the browser half calls.
 *
 * The settings card and the side panel live in the page, so they need a channel
 * to the host. A named route on the harness web server is that channel, and the
 * four paths every integration answers — status, login, logout, sync — come
 * from `dsh-integration-host`. What is left here is what is GitLab's: the reads
 * its panel makes, and the one write, which answers with the draft until the
 * caller confirms it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BadRequest,
	createIntegrationRoute,
	type RouteContext,
	type RouteHandler,
} from "dsh-integration-host";
import { isReviewAction, type ReviewRequest } from "../../shared/panel";
import type { GitLabAuthFace } from "../auth";
import type { PanelApi } from "../panels/panel";
import { ReviewRefusal, type ReviewService } from "../review";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-gitlab";

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly auth: GitLabAuthFace;
	readonly panel: PanelApi;
	readonly review: ReviewService;
}

/** One required query parameter, as a number. */
function numberParam(route: RouteContext, name: string): number {
	const raw = route.url.searchParams.get(name) ?? "";
	const value = Number(raw);

	if (!Number.isInteger(value) || value <= 0)
		throw new BadRequest(`the request needs a numeric "${name}"`);

	return value;
}

/** One required query parameter, as text. */
function textParam(route: RouteContext, name: string): string {
	const value = route.url.searchParams.get(name) ?? "";

	if (value === "") throw new BadRequest(`the request needs a "${name}"`);

	return value;
}

/** The side panel's own paths, tried after the four shared ones. */
const panelRoutes = (deps: ApiDeps): readonly RouteHandler[] => [
	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/token` ||
			route.method !== "POST"
		)
			return false;

		// The token is read and validated before any work starts, so a caller's
		// mistake is answered as one instead of as a bad gateway.
		const body = await route.read();
		const token = body.required("token");

		route.send(200, await deps.auth.saveToken(token));

		return true;
	},

	async (route) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/mr` || route.method !== "GET")
			return false;

		const project = textParam(route, "project");
		const iid = numberParam(route, "iid");

		await route.sendData(() => deps.panel.mergeRequest(project, iid));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/mr/pipeline` ||
			route.method !== "GET"
		)
			return false;

		const project = textParam(route, "project");
		const iid = numberParam(route, "iid");

		await route.sendData(() => deps.panel.pipeline(project, iid));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/mr/job` ||
			route.method !== "GET"
		)
			return false;

		const project = textParam(route, "project");
		const id = numberParam(route, "id");

		await route.sendData(() => deps.panel.jobLog(project, id));

		return true;
	},

	async (route) => {
		if (
			route.url.pathname !== `${ROUTE_PREFIX}/mr/review` ||
			route.method !== "POST"
		)
			return false;

		// The request is read and validated before any work starts, so a caller's
		// mistake is answered as one instead of as a bad gateway.
		const body = await route.read();
		const action = body.required("action");
		const project = body.required("project");
		const iid = Number(body.fields?.iid);
		const confirm = body.fields?.confirm === true;

		if (!isReviewAction(action))
			throw new BadRequest(`"${action}" is not a review action`);
		if (!Number.isInteger(iid) || iid <= 0)
			throw new BadRequest('"iid" must be a positive integer');

		const request: ReviewRequest = {
			project,
			iid,
			action,
			...(typeof body.fields?.body === "string"
				? { body: body.fields.body }
				: {}),
			...(typeof body.fields?.discussionId === "string"
				? { discussionId: body.fields.discussionId }
				: {}),
		};

		try {
			const outcome = await deps.review.submit(request, confirm);

			// Not confirmed: the answer is the wording the user must approve, and
			// nothing has been sent.
			if (!outcome.performed) {
				route.send(200, { draft: outcome.draft });
				return true;
			}

			// Confirmed: the answer is the merge request as it now stands, so the
			// panel renders what GitLab stored rather than what was asked for.
			route.send(200, await deps.panel.mergeRequest(project, iid));
		} catch (error) {
			if (error instanceof ReviewRefusal) {
				route.send(400, { error: error.message });
				return true;
			}

			throw error;
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

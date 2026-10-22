/**
 * The localhost API the settings card calls.
 *
 * The card lives in the page and the settings live in the host, so this is the
 * channel between them: what the digest is configured to do, and a button that
 * assembles one right now so the user can see what they are about to schedule.
 *
 * The four paths every integration answers — status, login, logout, sync — come
 * from `dsh-integration-host` and are inert here; what is left is the digest's
 * own two.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	createIntegrationRoute,
	type IntegrationAuthFace,
	type RouteContext,
	type RouteHandler,
} from "dsh-integration-host";
import type {
	DigestBlockView,
	DigestSettings,
	DigestSettingsView,
} from "../shared/digest";
import type { DigestStatus } from "../shared/status";
import type { DigestCollector } from "./collect";
import type { DigestSchedule } from "./schedule";
import type { DigestSettingsStore } from "./settings";

/** The route prefix this plugin owns. */
export const ROUTE_PREFIX = "/dsh-digest";

/** Everything the route answers with, wired once at apply time. */
export interface ApiDeps {
	readonly auth: IntegrationAuthFace<DigestStatus>;
	readonly settings: DigestSettingsStore;
	readonly collector: DigestCollector;
	readonly schedule: DigestSchedule;
}

/**
 * The document the settings card draws.
 *
 * The block list is read live rather than stored: a provider that was just
 * installed appears with its own declared default, and one that is gone stops
 * appearing, without either of them having to migrate the settings file.
 */
const viewOf = async (deps: ApiDeps): Promise<DigestSettingsView> => {
	const settings = await deps.settings.ensure();
	const offered = deps.collector.sources();
	const switches = deps.settings.switches(offered);
	const blocks: DigestBlockView[] = offered.map((block) => ({
		id: block.id,
		title: block.title,
		provider: block.provider,
		on: switches[block.id] === true,
	}));

	return {
		settings,
		blocks,
		providers: [...new Set(blocks.map((block) => block.provider))],
		scheduled: (await deps.schedule.bound()).length,
		canSchedule: deps.schedule.isAvailable,
	};
};

/**
 * Merge one card edit into the stored switches.
 *
 * The card only knows the blocks the installed sources offer, so a wholesale
 * replace would drop the switch of a provider that is temporarily uninstalled.
 * Merging keeps that choice for when it comes back.
 */
const patchOf = (
	current: DigestSettings,
	body: Record<string, unknown> | undefined,
): Record<string, unknown> => {
	const patch =
		body?.settings !== null && typeof body?.settings === "object"
			? (body.settings as Record<string, unknown>)
			: {};
	const blocks =
		patch.blocks !== null && typeof patch.blocks === "object"
			? (patch.blocks as Record<string, unknown>)
			: {};

	return {
		...patch,
		blocks: { ...current.blocks, ...blocks },
	};
};

/** Whether saving one edit changes when the digest arrives. */
const timingChanged = (
	before: DigestSettings,
	after: DigestSettings,
): boolean =>
	before.time !== after.time ||
	before.timeZone !== after.timeZone ||
	before.days.length !== after.days.length ||
	before.days.some((day) => !after.days.includes(day));

/** The digest's own paths, tried after the four shared ones. */
const digestRoutes = (deps: ApiDeps): readonly RouteHandler[] => [
	async (route: RouteContext) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/settings`) return false;

		if (route.method === "GET") {
			route.send(200, await viewOf(deps));

			return true;
		}

		if (route.method !== "POST") return false;

		const body = (await route.read()).fields;
		const before = await deps.settings.ensure();
		const after = await deps.settings.save(patchOf(before, body));

		// A change of time has to reach reminders that other sessions created, or
		// the card would be editing a value only the next `/digest on` reads.
		if (timingChanged(before, after)) await deps.schedule.rebindAll(after);

		route.send(200, await viewOf(deps));

		return true;
	},

	async (route: RouteContext) => {
		if (route.url.pathname !== `${ROUTE_PREFIX}/now` || route.method !== "POST")
			return false;

		const collected = await deps.collector.collect(
			`digest-settings-${Date.now()}`,
			new Date(),
		);

		route.send(200, collected.report);

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
		routes: digestRoutes(deps),
	});
};

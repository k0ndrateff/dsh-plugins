/**
 * What GitLab contributes to a chain.
 *
 * Two kinds, because GitLab is where a chain stops being about an identifier and
 * starts being about work: asked about a **commit**, it answers with the commit
 * itself and points at the merge requests that contain it; asked about a **merge
 * request**, it answers with the request and points at the tracker key its title
 * or its source branch names. Nothing is resolved on GitLab's side beyond what
 * GitLab knows — the ticket belongs to whichever tracker owns it.
 *
 * A commit reference arrives from another provider, so it carries a link rather
 * than a project path: this reads the project out of a link it recognizes as its
 * own instance and declines anything else, which is what keeps two code hosts
 * from both claiming one commit.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	CORRELATION_SOURCES,
	type CorrelationFact,
	type CorrelationRef,
	type CorrelationSource,
} from "dsh-integration-host";
import type { GitLabApi } from "./api";
import type { GitLabConfig } from "./config";

/** The tracker key a merge request's title or branch may name, such as `DEV-5977`. */
// A dot after the number is a version, not a ticket: `lodash-4.17.21` must not
// become `LODASH-4`.
const TRACKER_KEY = /\b([A-Z][A-Z0-9]+-\d+)(?![.\d])/u;

/** The route that ends a project path in a GitLab web link. */
const PROJECT_END =
	/\/(?:-\/)?(?:blob|tree|raw|commit|commits|merge_requests|issues|pipelines)(?:\/|$)/u;

/** Everything the source reads through, wired once at apply time. */
export interface CorrelationDeps {
	readonly api: GitLabApi;
	readonly config: GitLabConfig;
}

/** One JSON record, when the answer is one. */
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** A string field of a JSON record, when it holds one. */
const stringOf = (value: unknown, key: string): string | undefined => {
	const member = recordOf(value)?.[key];

	return typeof member === "string" && member !== "" ? member : undefined;
};

/** The people named on an answer, as one line. */
const personOf = (value: unknown): string | undefined => {
	if (typeof value === "string") return value === "" ? undefined : value;

	const record = recordOf(value);

	return stringOf(record, "name") ?? stringOf(record, "username");
};

/** The one supporting detail a hop shows. */
const metaOf = (parts: readonly (string | undefined)[]): string | undefined => {
	const shown = parts.filter(
		(part): part is string => part !== undefined && part !== "",
	);

	return shown.length === 0 ? undefined : shown.join(" · ");
};

/** One line, from the parts that are there. */
const lineOf = (parts: readonly (string | undefined)[]): string =>
	parts
		.filter((part): part is string => part !== undefined && part !== "")
		.join(" · ");

/**
 * The project path a link names, when the link is this instance's.
 *
 * A GitLab web link carries the project path before the route that follows it,
 * in either the current `/-/` form or the older bare one. Anything on another
 * host is not this source's business, and says so by answering nothing.
 */
const projectOf = (deps: CorrelationDeps, url: string): string | undefined => {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	if (parsed.host !== new URL(deps.config.endpoint).host) return undefined;

	const path = parsed.pathname.replace(/^\/+/u, "").replace(/\/+$/u, "");
	const cut = path.search(PROJECT_END);

	return cut > 0 ? path.slice(0, cut) : undefined;
};

/** One tracker key as a reference, if the text names one. */
const taskRefOf = (
	text: string | undefined,
): { readonly kind: "task"; readonly key: string } | undefined => {
	const key = text === undefined ? undefined : TRACKER_KEY.exec(text)?.[1];

	return key === undefined ? undefined : { kind: "task", key };
};

/** The keys a merge request names, each once. */
const taskRefsOf = (title: string | undefined, branch: string | undefined) => {
	const found = [
		taskRefOf(title),
		// A branch spells a key in its own case, with its own separators:
		// `dev-5977-fix` and `fix_dev_5977` both name `DEV-5977`. Dots stay, so a
		// version such as `lodash-4.17.21` cannot become a ticket key.
		taskRefOf(branch?.replace(/[_/]/gu, "-").toUpperCase()),
	].filter((ref) => ref !== undefined);

	return [...new Map(found.map((ref) => [ref.key, ref])).values()];
};

/**
 * The commit's own fact, and the merge requests that contain it.
 *
 * The commit's details are best effort: a project that does not let the token
 * read the commit still answers about its merge requests, and the reference
 * already carries what Sentry said about it.
 * @param deps - the REST channel and the configured instance.
 * @param project - the project path, already read from the reference.
 * @param ref - the commit reference being resolved.
 */
const commitFacts = async (
	deps: CorrelationDeps,
	project: string,
	ref: CorrelationRef,
): Promise<readonly CorrelationFact[]> => {
	if (ref.kind !== "commit") return [];

	const encoded = encodeURIComponent(project);
	const [commit, requests] = await Promise.all([
		deps.api
			.get<unknown>(`/projects/${encoded}/repository/commits/${ref.sha}`)
			.catch(() => undefined),
		deps.api.get<unknown>(
			`/projects/${encoded}/repository/commits/${ref.sha}/merge_requests`,
		),
	]);
	const message = stringOf(commit, "title") ?? stringOf(commit, "message");
	const url = stringOf(commit, "web_url");
	const meta = metaOf([
		stringOf(commit, "author_name"),
		stringOf(commit, "created_at")?.slice(0, 10),
	]);
	const references: CorrelationRef[] = (Array.isArray(requests) ? requests : [])
		.map((request): CorrelationRef | undefined => {
			const iid = recordOf(request)?.iid;

			return typeof iid === "number"
				? {
						kind: "change",
						repository: project,
						number: String(iid),
						label: `${project}!${String(iid)}`,
					}
				: undefined;
		})
		.filter((item): item is CorrelationRef => item !== undefined);

	return [
		{
			id: `gitlab:${project}@${ref.sha}`,
			provider: "GitLab",
			kind: "commit",
			label: "Commit",
			title: lineOf([ref.sha.slice(0, 7), message ?? ref.label]),
			...(url === undefined ? {} : { url }),
			...(meta === undefined ? {} : { meta }),
			...(references.length === 0 ? {} : { references }),
		},
	];
};

/** The merge request's own fact, and the tracker keys it names. */
const changeFacts = async (
	deps: CorrelationDeps,
	ref: CorrelationRef,
): Promise<readonly CorrelationFact[]> => {
	if (ref.kind !== "change") return [];

	const encoded = encodeURIComponent(ref.repository);
	const request = await deps.api.get<unknown>(
		`/projects/${encoded}/merge_requests/${ref.number}`,
	);
	const record = recordOf(request);
	const title = stringOf(record, "title");
	const url = stringOf(record, "web_url");
	const meta = metaOf([stringOf(record, "state"), personOf(record?.author)]);
	const references = taskRefsOf(title, stringOf(record, "source_branch"));

	return [
		{
			id: `gitlab:${ref.repository}!${ref.number}`,
			provider: "GitLab",
			kind: "change",
			label: "Merge request",
			title: lineOf([`${ref.repository}!${ref.number}`, title]),
			...(url === undefined ? {} : { url }),
			...(meta === undefined ? {} : { meta }),
			...(references.length === 0 ? {} : { references }),
		},
	];
};

/** The GitLab contribution. */
export const gitLabCorrelationSource = (
	deps: CorrelationDeps,
): CorrelationSource => ({
	provider: "GitLab",
	entry: "change",
	resolves: ["commit", "change"],
	resolve: async (ref: CorrelationRef) => {
		if (ref.kind === "commit") {
			const fallback = ref.repository;
			const project =
				ref.url === undefined ? fallback : projectOf(deps, ref.url);

			return project === undefined || project === ""
				? []
				: await commitFacts(deps, project, ref);
		}

		return await changeFacts(deps, ref);
	},
});

/**
 * Offer GitLab's chain contribution to the correlation plugin, if it is installed.
 * @param ctx - the plugin's host context.
 * @param deps - the REST channel and the configured instance.
 */
export const registerCorrelationSource = (
	ctx: Context,
	deps: CorrelationDeps,
): void => {
	ctx.inject([CORRELATION_SOURCES], (scoped) => {
		scoped.effect(
			() => scoped.correlationSources.register(gitLabCorrelationSource(deps)),
			"gitlab: correlation source",
		);
	});
};

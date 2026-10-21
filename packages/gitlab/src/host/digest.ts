/**
 * What GitLab contributes to a digest.
 *
 * Three blocks: the merge requests waiting for this user's review, the user's
 * own merge requests, and — off by default — the review comments a bot left on
 * the user's merge requests inside the window. All three read through the same
 * REST channel and the same parsers the panel and `gitlab_present` use, so a
 * digest row and a card row are one merge request described one way.
 *
 * The source registers itself with the digest registry rather than being
 * imported by it; a deployment without the digest plugin never calls this.
 */

import type { Context } from "@deepseek-ai/cordis";
import {
	DIGEST_SOURCES,
	type DigestItem,
	type DigestLoadOptions,
	type DigestSource,
	type RuntimeState,
} from "dsh-integration-host";
import type { MergeRequestCard } from "../shared/meta";
import type { GitLabAccount } from "./account";
import type { GitLabApi, Param } from "./api";
import { parseDiscussions, parseMergeRequestList } from "./presentation/parse";

/** How many of the user's merge requests are asked for their discussions. */
const DISCUSSION_LIMIT = 10;

/** The author whose notes the CodeRabbit block reports. */
const CODERABBIT = /coderabbit/iu;

/** Everything the source reads through, wired once at apply time. */
export interface DigestDeps {
	readonly api: GitLabApi;
	readonly state: RuntimeState<GitLabAccount>;
}

/**
 * The first line of a review note, as one digest row's title.
 *
 * A CodeRabbit note opens with a heading and then explains itself for pages;
 * the digest wants the heading. Markdown's own markers are dropped because the
 * row is drawn as text, not rendered.
 * @param body - the note's Markdown.
 * @returns one bounded line, or an empty string when the note has no text.
 */
export const firstLineOf = (body: string): string => {
	for (const line of body.split(/\r?\n/u)) {
		const text = line.replace(/^[#>\-*\s]+/u, "").trim();

		if (text !== "") return text.length > 160 ? `${text.slice(0, 157)}…` : text;
	}

	return "";
};

/** One merge request, as a digest row. */
const toItem = (card: MergeRequestCard): DigestItem => {
	const meta = [
		card.state,
		card.draft === true ? "draft" : undefined,
		card.pipeline,
		card.unresolved === undefined ? undefined : `${card.unresolved} unresolved`,
	]
		.filter(Boolean)
		.join(" · ");

	return {
		id: `${card.project}!${card.iid}`,
		title: `${card.project}!${card.iid} · ${card.title}`,
		...(card.url === undefined ? {} : { url: card.url }),
		...(meta === "" ? {} : { meta }),
	};
};

class GitLabDigest {
	constructor(private readonly deps: DigestDeps) {}

	/** The rows one block contributes. */
	async load(
		blockId: string,
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]> {
		if (blockId === "coderabbit") return await this.codeRabbit(options);

		const scope =
			blockId === "gitlab-review"
				? "review_requested"
				: blockId === "gitlab-mine"
					? "created_by_me"
					: undefined;

		if (scope === undefined)
			throw new Error(`no GitLab block named "${blockId}"`);

		return (await this.mergeRequests(scope, options)).map(toItem);
	}

	/** One scoped merge request list. */
	private async mergeRequests(
		scope: "review_requested" | "created_by_me",
		options: DigestLoadOptions,
	): Promise<readonly MergeRequestCard[]> {
		const params: Record<string, Param> = {
			state: "opened",
			per_page: options.limit,
			order_by: "updated_at",
			sort: "desc",
		};

		if (scope === "review_requested") {
			const username = this.deps.state.facts?.username;

			if (username === undefined)
				throw new Error(
					"the GitLab account is not known yet; run /gitlab sync",
				);

			params.reviewer_username = username;
		} else {
			params.scope = scope;
		}

		const answer = await this.deps.api.getAnswer("/merge_requests", params);

		return parseMergeRequestList(answer.value).items.slice(0, options.limit);
	}

	/** The bot's review notes on the user's own merge requests. */
	private async codeRabbit(
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]> {
		const mine = await this.mergeRequests("created_by_me", {
			...options,
			limit: Math.min(options.limit, DISCUSSION_LIMIT),
		});
		const items: DigestItem[] = [];

		for (const card of mine) {
			const discussions = parseDiscussions(
				await this.deps.api.get(
					`/projects/${encodeURIComponent(card.project)}/merge_requests/${card.iid}/discussions`,
					{ per_page: 100 },
				),
			);

			for (const discussion of discussions) {
				for (const note of discussion.notes) {
					if (note.system || note.internal) continue;
					if (!CODERABBIT.test(note.author?.username ?? "")) continue;

					const createdAt =
						note.createdAt === undefined
							? undefined
							: Date.parse(note.createdAt);

					if (createdAt !== undefined && createdAt < options.since.getTime())
						continue;

					const title = firstLineOf(note.body);

					if (title === "") continue;

					items.push({
						id: `${card.project}!${card.iid}#${note.id ?? discussion.id}`,
						title,
						...(card.url === undefined
							? {}
							: { url: `${card.url}#note_${note.id ?? ""}` }),
						meta: `${card.project}!${card.iid} · ${note.author?.username ?? "bot"}`,
					});

					if (items.length >= options.limit) return items;
				}
			}
		}

		return items;
	}
}

/** The GitLab contribution. */
export const gitlabDigestSource = (deps: DigestDeps): DigestSource => {
	const digest = new GitLabDigest(deps);

	return {
		provider: "GitLab",
		blocks: [
			{
				id: "gitlab-review",
				title: "GitLab · Waiting for my review",
				defaultOn: true,
			},
			{
				id: "gitlab-mine",
				title: "GitLab · My merge requests",
				defaultOn: true,
			},
			{
				id: "coderabbit",
				title: "GitLab · CodeRabbit comments",
				defaultOn: false,
			},
		],
		load: async (blockId, options) => await digest.load(blockId, options),
	};
};

/**
 * Offer GitLab's blocks to the digest plugin, if it is installed.
 * @param ctx - the plugin's host context.
 * @param deps - the REST channel and the account facts.
 */
export const registerDigestSource = (ctx: Context, deps: DigestDeps): void => {
	ctx.inject([DIGEST_SOURCES], (scoped) => {
		scoped.effect(
			() => scoped.digestSources.register(gitlabDigestSource(deps)),
			"gitlab: digest source",
		);
	});
};

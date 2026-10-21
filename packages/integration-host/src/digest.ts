/**
 * The seam a digest is assembled through.
 *
 * A digest spans several integrations, and none of them may import another's
 * code: the browser and host bundles are separate, and a plugin's own readers
 * belong to it. So the *shape* of a contribution lives here, in the library
 * every integration already shares, and the digest plugin owns the registry
 * those contributions arrive in. An integration registers what it can report;
 * the digest plugin decides when to ask and how to lay the answers out.
 *
 * A source is one provider's promise to answer one block. The block's title and
 * its default switch travel with it, because the provider is the only party
 * that knows what it is offering — the digest card is drawn from whatever the
 * installed sources declare, never from a list this library keeps.
 */

import type { Context } from "@deepseek-ai/cordis";
import { Service } from "@deepseek-ai/cordis";

/** The service name the digest plugin provides and every source registers into. */
export const DIGEST_SOURCES = "digestSources";

/**
 * One row a block contributes.
 *
 * Deliberately small: a digest is read at a glance, so a row carries a line, a
 * link, and one supporting detail. A provider that wants to say more says it in
 * `meta`; the card gives no row more room than that.
 */
export interface DigestItem {
	/** Stable within its block; what keys the row. */
	readonly id: string;
	/** The row's own line, such as `DEV-6477 · Fix the parser`. */
	readonly title: string;
	readonly url?: string;
	/** One supporting detail, such as `In review · due today`. */
	readonly meta?: string;
}

/** One block of the digest, as the provider that owns it declares it. */
export interface DigestBlockSpec {
	/** Stable across restarts: what a saved switch is stored under. */
	readonly id: string;
	/** The block's heading on the card, such as `Jira · In progress`. */
	readonly title: string;
	/** The switch a user who has never touched it gets. */
	readonly defaultOn: boolean;
}

/** What one load is allowed to assume about its window. */
export interface DigestLoadOptions {
	/** How far back a block that reports "recent" work looks. */
	readonly since: Date;
	/** The most rows the card will show from this block. */
	readonly limit: number;
}

/** One provider's contribution to every digest. */
export interface DigestSource {
	/** The provider's name as the user sees it, such as `GitLab`. */
	readonly provider: string;
	readonly blocks: readonly DigestBlockSpec[];
	/**
	 * Answer one block.
	 * @param blockId - one of this source's own block ids.
	 * @param options - the window and the row cap the digest is assembling under.
	 * @returns the rows to show; an empty list is a truthful "nothing to report".
	 * @throws when the provider could not be read; the digest reports the reason
	 *   against that block instead of failing whole.
	 */
	load(
		blockId: string,
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]>;
}

/** What one registered source offers, with the provider that owns it. */
export interface DigestBlockEntry extends DigestBlockSpec {
	readonly provider: string;
}

/**
 * The registry of digest sources.
 *
 * Owned by the digest plugin and provided as `ctx.digestSources`. An
 * integration registers through a scoped `ctx.inject([DIGEST_SOURCES], …)`, so
 * a deployment without the digest plugin simply never calls it and nothing
 * waits for a service that will not arrive.
 */
export class DigestSources extends Service {
	private readonly sources: DigestSource[] = [];

	constructor(ctx: Context) {
		super(ctx, DIGEST_SOURCES);
	}

	/**
	 * Add one provider's contribution.
	 * @param source - the blocks this provider offers and how to load them.
	 * @returns the exact disposer that withdraws them.
	 * @throws when the provider declares a block id another provider already owns.
	 */
	register(source: DigestSource): () => void {
		const clash = source.blocks.find((block) =>
			this.sources.some((other) =>
				other.blocks.some((taken) => taken.id === block.id),
			),
		);

		if (clash !== undefined)
			throw new Error(
				`digest block "${clash.id}" is already registered by another provider`,
			);

		this.sources.push(source);

		return () => {
			const index = this.sources.indexOf(source);
			if (index >= 0) this.sources.splice(index, 1);
		};
	}

	/** Every block on offer, in registration order, with its owning provider. */
	get blocks(): readonly DigestBlockEntry[] {
		return this.sources.flatMap((source) =>
			source.blocks.map((block) => ({ ...block, provider: source.provider })),
		);
	}

	/** The providers that have registered, in registration order. */
	get providers(): readonly string[] {
		return this.sources.map((source) => source.provider);
	}

	/**
	 * Ask the provider that owns one block.
	 * @param blockId - a block id from {@link blocks}.
	 * @param options - the window and the row cap.
	 * @throws when no registered provider offers that block.
	 */
	async load(
		blockId: string,
		options: DigestLoadOptions,
	): Promise<readonly DigestItem[]> {
		for (const source of this.sources) {
			if (source.blocks.some((block) => block.id === blockId))
				return await source.load(blockId, options);
		}

		throw new Error(`no digest source offers the block "${blockId}"`);
	}
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		/** The digest registry; present only while the digest plugin is loaded. */
		digestSources: DigestSources;
	}
}

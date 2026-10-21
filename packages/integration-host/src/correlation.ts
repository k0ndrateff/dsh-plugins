/**
 * The seam a cross-provider chain is assembled through.
 *
 * One answer spans several integrations — an error names a commit, a commit
 * belongs to a merge request, a merge request names a ticket — and none of them
 * may import another's code: the browser and host bundles are separate, and a
 * plugin's own readers belong to it. So the *vocabulary* of a chain lives here,
 * in the library every integration already shares, and the correlation plugin
 * owns the registry those contributions arrive in.
 *
 * The vocabulary is deliberately about the world, not about a vendor: an error,
 * a commit, a change request, and a tracked task exist whatever the tool is
 * called. A provider says which of them it can resolve and what it knows when
 * asked; it never names another provider, and it never parses another provider's
 * identifier. Where two providers must agree — the commit a code host can look
 * up, the key a tracker recognizes — the shared shape here is that agreement,
 * and a reference carries a link alongside it so the other side can find its own
 * way to the same object.
 *
 * A source answers *about the reference it was asked about* with a fact, and
 * that fact carries the references onward. A walker therefore never needs to
 * know what a chain looks like: the links are data.
 */

import type { Context } from "@deepseek-ai/cordis";
import { Service } from "@deepseek-ai/cordis";

/** The service name the correlation plugin provides and every source registers into. */
export const CORRELATION_SOURCES = "correlationSources";

/** The kinds of thing a chain is made of. */
export type CorrelationKind = "error" | "commit" | "change" | "task";

/**
 * A pointer from one fact to another.
 *
 * Each variant carries what the *resolving* side needs to find the object
 * itself, and nothing about how that side is implemented. `label` is what the
 * card calls the unreachable hop when nobody resolves it.
 */
export type CorrelationRef =
	| { readonly kind: "error"; readonly id: string; readonly label?: string }
	| {
			readonly kind: "commit";
			readonly sha: string;
			/**
			 * A web address anywhere in the repository the commit lives in.
			 *
			 * It is how a code host recognizes its own project without either
			 * side agreeing on a naming scheme: the host reads the path it
			 * already knows how to read, and ignores the rest.
			 */
			readonly url?: string;
			/** The repository as the referring side names it, when it names one. */
			readonly repository?: string;
			readonly label?: string;
	  }
	| {
			readonly kind: "change";
			/** The project path the change request lives in, as the code host spells it. */
			readonly repository: string;
			/** The project-local number, without any prefix. */
			readonly number: string;
			readonly url?: string;
			readonly label?: string;
	  }
	| { readonly kind: "task"; readonly key: string; readonly label?: string };

/** What one provider knows about one reference. */
export interface CorrelationFact {
	/** Stable across the chain: what two providers' answers are deduplicated by. */
	readonly id: string;
	/** The provider's name as the user sees it, such as `Sentry`. */
	readonly provider: string;
	/** Which reference shape this fact answers. */
	readonly kind: CorrelationKind;
	/** What the card calls this hop, such as `Suspect commit`. */
	readonly label: string;
	/** The hop's own line, such as `CHECKOUT-13P · AxiosError: …`. */
	readonly title: string;
	readonly url?: string;
	/** One supporting detail, such as `unresolved · 35 events`. */
	readonly meta?: string;
	/** What this fact points at, which this or another provider resolves next. */
	readonly references?: readonly CorrelationRef[];
}

/** One provider's contribution to every chain. */
export interface CorrelationSource {
	/** The provider's name as the user sees it, such as `GitLab`. */
	readonly provider: string;
	/** The kind a chain starts from when the user names this provider. */
	readonly entry: CorrelationKind;
	/**
	 * The kinds this source can resolve.
	 *
	 * A reference nobody declares is reported as an unreachable hop rather than
	 * silently dropped, so a missing integration is legible on the card.
	 */
	readonly resolves: readonly CorrelationKind[];
	/**
	 * Answer one reference.
	 * @param ref - the reference to resolve; its `kind` is one this source listed.
	 * @returns the fact for that reference, and any it can already name beside it.
	 * @throws when the provider could not be read; the walker reports the reason
	 *   against that hop instead of failing the chain.
	 */
	resolve(ref: CorrelationRef): Promise<readonly CorrelationFact[]>;
}

/** One registered source, as the walker sees it. */
export interface CorrelationSourceEntry {
	readonly provider: string;
	readonly entry: CorrelationKind;
	readonly resolves: readonly CorrelationKind[];
}

/**
 * The registry of correlation sources.
 *
 * Owned by the correlation plugin and provided as `ctx.correlationSources`. An
 * integration registers through a scoped `ctx.inject([CORRELATION_SOURCES], …)`,
 * so a deployment without the correlation plugin simply never calls it and
 * nothing waits for a service that will not arrive.
 */
export class CorrelationSources extends Service {
	private readonly sources: CorrelationSource[] = [];

	constructor(ctx: Context) {
		super(ctx, CORRELATION_SOURCES);
	}

	/**
	 * Add one provider's contribution.
	 * @param source - the kinds this provider resolves and how to resolve them.
	 * @returns the exact disposer that withdraws them.
	 * @throws when a provider of that name is already registered.
	 */
	register(source: CorrelationSource): () => void {
		if (this.sources.some((other) => other.provider === source.provider))
			throw new Error(
				`a correlation source named "${source.provider}" is already registered`,
			);

		this.sources.push(source);

		return () => {
			const index = this.sources.indexOf(source);
			if (index >= 0) this.sources.splice(index, 1);
		};
	}

	/** Every provider on offer, in registration order. */
	get providers(): readonly CorrelationSourceEntry[] {
		return this.sources.map((source) => ({
			provider: source.provider,
			entry: source.entry,
			resolves: source.resolves,
		}));
	}

	/**
	 * Whether any installed integration can resolve one kind.
	 *
	 * The walker asks before it resolves so that "GitLab is not installed" and
	 * "GitLab found no merge request for this commit" stay different answers.
	 */
	canResolve(kind: CorrelationKind): boolean {
		return this.sources.some((source) => source.resolves.includes(kind));
	}

	/**
	 * The kind a chain starts from when the user names one provider.
	 * @param provider - a provider's name as the user sees it.
	 * @returns that provider's entry kind, or undefined when it is not installed.
	 */
	entryOf(provider: string): CorrelationKind | undefined {
		return this.sources.find((source) => source.provider === provider)?.entry;
	}

	/**
	 * Ask whichever providers resolve one reference.
	 *
	 * A kind may have more than one owner — two code hosts both answer for
	 * commits — so each is asked in turn and the first that recognizes the
	 * reference answers. One that does not returns nothing rather than failing.
	 * @param ref - the reference to resolve.
	 * @throws when no registered provider resolves that kind.
	 */
	async resolve(ref: CorrelationRef): Promise<readonly CorrelationFact[]> {
		const owners = this.sources.filter((source) =>
			source.resolves.includes(ref.kind),
		);

		if (owners.length === 0)
			throw new Error(
				`no correlation source resolves "${ref.kind}" references`,
			);

		for (const owner of owners) {
			const facts = await owner.resolve(ref);

			if (facts.length > 0) return facts;
		}

		return [];
	}
}

declare module "@deepseek-ai/cordis" {
	interface Context {
		/** The correlation registry; present only while the correlation plugin is loaded. */
		correlationSources: CorrelationSources;
	}
}

/**
 * The Sentry organizations this installation works with.
 *
 * Every issue search and every issue URL needs an organization slug, and the
 * plugin learns the account's list once. `find_organizations` declares its
 * answer, so this reads the declared fields rather than guessing:
 * `{organizations: [{slug, webUrl, regionUrl}], hasMore, nextCursor}`.
 *
 * An account may belong to several organizations, so every one of them is
 * kept, one is the selected default, and a card or panel may name its own
 * organization explicitly. The choice is remembered beside the tokens.
 */

import type { FactsReader } from "dsh-integration-host";
import {
	asRecord,
	type Grant,
	type JsonValue,
	mcpJson,
	pickString,
} from "dsh-mcp-oauth";

/** The tool whose answer names the account's organizations. */
export const ORGANIZATIONS_TOOL = "find_organizations";

/** How many organizations one account's list is read for. */
const MAX_ORGANIZATIONS = 50;

/** One organization the account belongs to. */
export interface SentryOrganization {
	readonly slug: string;
	/** Base URL, without a trailing slash, when Sentry named one. */
	readonly webUrl?: string;
}

export class OrganizationFacts {
	readonly slug?: string;
	readonly webUrl?: string;
	/** Every organization the account's own list named, in its order. */
	readonly organizations: readonly SentryOrganization[];

	constructor(params: {
		slug?: string;
		webUrl?: string;
		organizations?: readonly SentryOrganization[];
	}) {
		this.slug = params.slug;
		this.webUrl = params.webUrl;
		this.organizations = params.organizations ?? [];
	}

	/** What the stored grant already knows, if anything. */
	static from(grant: Grant | undefined): OrganizationFacts {
		const extra = grant?.extra;

		return new OrganizationFacts({
			...(typeof extra?.organization === "string"
				? { slug: extra.organization }
				: {}),
			...(typeof extra?.organizationUrl === "string"
				? { webUrl: extra.organizationUrl }
				: {}),
			organizations: organizationsOf(extra?.organizations),
		});
	}

	/**
	 * Read every organization of an account's own list.
	 *
	 * The first organization is selected as the default; every one is kept so
	 * the settings card can offer the others and a card can carry its own.
	 * @param value - the result of `find_organizations`.
	 * @returns the facts it names, or empty facts when it names none.
	 */
	static parse(value: unknown): OrganizationFacts {
		const organizations: SentryOrganization[] = [];

		for (const root of mcpJson(value)) {
			const list = asRecord(root)?.organizations;
			if (!Array.isArray(list)) continue;

			for (const item of list) {
				const record = asRecord(item);
				const slug = pickString(record, "slug");
				const webUrl = pickString(record, "webUrl", "url");

				if (slug === undefined) continue;
				if (organizations.some((entry) => entry.slug === slug)) continue;

				organizations.push({
					slug,
					...(webUrl === undefined
						? {}
						: { webUrl: stripTrailingSlash(webUrl) }),
				});

				if (organizations.length >= MAX_ORGANIZATIONS) break;
			}
		}

		if (organizations.length === 0) return new OrganizationFacts({});

		const first = organizations[0] as SentryOrganization;

		return new OrganizationFacts({
			organizations,
			slug: first.slug,
			...(first.webUrl === undefined ? {} : { webUrl: first.webUrl }),
		});
	}

	/** Whether neither the slug nor the URL is known. */
	get isEmpty(): boolean {
		return this.slug === undefined && this.webUrl === undefined;
	}

	/** Whether both the slug and the URL are known, so nothing is left to learn. */
	get isComplete(): boolean {
		return this.slug !== undefined && this.webUrl !== undefined;
	}

	/**
	 * Select one of the known organizations as the default.
	 * @param slug - the organization to work with.
	 * @returns the facts with it selected, or undefined when it is not known.
	 */
	withSelection(slug: string): OrganizationFacts | undefined {
		const organization = this.organizations.find(
			(candidate) => candidate.slug === slug,
		);

		if (organization === undefined) return undefined;

		return new OrganizationFacts({
			organizations: this.organizations,
			slug: organization.slug,
			...(organization.webUrl === undefined
				? {}
				: { webUrl: organization.webUrl }),
		});
	}

	/** The URL of one organization, when the account's list named it. */
	urlOf(slug: string | undefined): string | undefined {
		if (slug === undefined) return this.webUrl;

		const known = this.organizations.find((entry) => entry.slug === slug);

		if (known !== undefined) return known.webUrl;

		return slug === this.slug ? this.webUrl : undefined;
	}
}

/** How Sentry's own organization list is read, merged, and remembered. */
export const organizationFacts: FactsReader<OrganizationFacts> = {
	toolName: ORGANIZATIONS_TOOL,
	from: (grant) => OrganizationFacts.from(grant),
	parse: (value) => OrganizationFacts.parse(value),
	merge: (known, learned) => {
		const organizations = mergeOrganizations(
			learned.organizations,
			known?.organizations ?? [],
		);
		const selected =
			known?.slug === undefined
				? undefined
				: organizations.find((entry) => entry.slug === known.slug);

		return new OrganizationFacts({
			organizations,
			slug: selected?.slug ?? learned.slug ?? known?.slug,
			webUrl: selected?.webUrl ?? learned.webUrl ?? known?.webUrl,
		});
	},
	remember: (facts) => ({
		...(facts.slug === undefined ? {} : { organization: facts.slug }),
		...(facts.webUrl === undefined ? {} : { organizationUrl: facts.webUrl }),
		...(facts.organizations.length === 0
			? {}
			: {
					organizations: facts.organizations.map(
						(entry): JsonValue => ({
							slug: entry.slug,
							...(entry.webUrl === undefined ? {} : { webUrl: entry.webUrl }),
						}),
					),
				}),
	}),
};

/** The learned list first, then whatever the stored list adds. */
function mergeOrganizations(
	learned: readonly SentryOrganization[],
	known: readonly SentryOrganization[],
): readonly SentryOrganization[] {
	const merged = [...learned];

	for (const organization of known) {
		if (merged.some((candidate) => candidate.slug === organization.slug))
			continue;

		merged.push(organization);
	}

	return merged.slice(0, MAX_ORGANIZATIONS);
}

/** The stored organization list, when the record carries one. */
function organizationsOf(
	value: JsonValue | undefined,
): readonly SentryOrganization[] {
	if (!Array.isArray(value)) return [];

	const organizations: SentryOrganization[] = [];

	for (const item of value) {
		const record = asRecord(item);
		const slug = pickString(record, "slug");

		if (slug === undefined) continue;
		if (organizations.some((entry) => entry.slug === slug)) continue;

		const webUrl = pickString(record, "webUrl");

		organizations.push({
			slug,
			...(webUrl === undefined ? {} : { webUrl: stripTrailingSlash(webUrl) }),
		});
	}

	return organizations;
}

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/u, "");
}

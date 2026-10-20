/**
 * The Sentry organization this installation works with.
 *
 * Every issue search and every issue URL needs an organization slug, and the
 * plugin learns it once from the account's own list. `find_organizations`
 * declares its answer, so this reads the declared fields rather than guessing:
 * `{organizations: [{slug, webUrl, regionUrl}], hasMore, nextCursor}`.
 */

import { asRecord, type Grant, mcpJson, pickString } from "dsh-mcp-oauth";

/** The tool whose answer names the account's organizations. */
export const ORGANIZATIONS_TOOL = "find_organizations";

export class OrganizationFacts {
	readonly slug?: string;
	readonly webUrl?: string;

	constructor(params: { slug?: string; webUrl?: string }) {
		this.slug = params.slug;
		this.webUrl = params.webUrl;
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
		});
	}

	/**
	 * Read the first organization of an account's own list.
	 * @param value - the result of `find_organizations`.
	 * @returns the facts it names, or empty facts when it names none.
	 */
	static parse(value: unknown): OrganizationFacts {
		for (const root of mcpJson(value)) {
			const organizations = asRecord(root)?.organizations;

			if (!Array.isArray(organizations)) continue;

			const first = asRecord(organizations[0]);
			const slug = pickString(first, "slug");
			const webUrl = pickString(first, "webUrl", "url");

			if (slug === undefined && webUrl === undefined) continue;

			return new OrganizationFacts({
				...(slug === undefined ? {} : { slug }),
				...(webUrl === undefined
					? {}
					: { webUrl: webUrl.replace(/\/+$/u, "") }),
			});
		}

		return new OrganizationFacts({});
	}

	/** Whether neither the slug nor the URL is known. */
	get isEmpty(): boolean {
		return this.slug === undefined && this.webUrl === undefined;
	}
}

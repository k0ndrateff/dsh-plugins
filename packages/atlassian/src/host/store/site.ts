/**
 * The Atlassian sites this installation works with.
 *
 * Atlassian withholds `webUrl` from clients it does not recognize by name, so
 * the account's own list of sites is what gives a card a link and every Jira
 * and Confluence tool call the cloud id it requires. An account may reach more
 * than one site, so every site is kept, one of them is the selected default,
 * and a card or panel may name its own site explicitly. The facts are read
 * once, remembered in the credential record, and restored on the next start.
 */

import type { FactsReader } from "dsh-integration-host";
import { asRecord, type Grant, type JsonValue, mcpJson } from "dsh-mcp-oauth";

/** The tool whose answer names the account's sites. */
export const SITE_TOOL = "getAccessibleAtlassianResources";

/** How many sites one account's list is read for. */
const MAX_SITES = 50;

/** One site the account can reach. */
export interface AtlassianSite {
	/** Base URL, without a trailing slash. */
	readonly url: string;
	/** The id every Jira and Confluence call names. */
	readonly cloudId: string;
}

export class SiteFacts {
	readonly siteUrl?: string;
	readonly cloudId?: string;
	/** Every site the account's own list named, in its order. */
	readonly sites: readonly AtlassianSite[];

	constructor(params: {
		siteUrl?: string;
		cloudId?: string;
		sites?: readonly AtlassianSite[];
	}) {
		this.siteUrl = params.siteUrl;
		this.cloudId = params.cloudId;
		this.sites = params.sites ?? [];
	}

	/** What the stored grant already knows, if anything. */
	static from(grant: Grant | undefined): SiteFacts {
		const extra = grant?.extra;

		return new SiteFacts({
			...(typeof extra?.siteUrl === "string" ? { siteUrl: extra.siteUrl } : {}),
			...(typeof extra?.cloudId === "string" ? { cloudId: extra.cloudId } : {}),
			sites: sitesOf(extra?.sites),
		});
	}

	/**
	 * Read every site of an account's own list.
	 *
	 * The first site is selected as the default; every site is kept so the
	 * settings card can offer the others and a card can carry its own cloud id.
	 * @param value - the result of `getAccessibleAtlassianResources`.
	 * @returns the facts it names, or empty facts when it names none.
	 */
	static parse(value: unknown): SiteFacts {
		const sites: AtlassianSite[] = [];

		for (const root of mcpJson(value)) {
			const list = asRecord(root)?.data ?? root;

			if (!Array.isArray(list)) continue;

			for (const item of list) {
				const record = asRecord(item);
				if (record === undefined) continue;

				const url = stringOf(record.url);
				const cloudId = stringOf(record.id);

				if (url === undefined || cloudId === undefined) continue;
				if (sites.some((site) => site.cloudId === cloudId)) continue;

				sites.push({ url: stripTrailingSlash(url), cloudId });

				if (sites.length >= MAX_SITES) break;
			}
		}

		if (sites.length === 0) return new SiteFacts({});

		const first = sites[0] as AtlassianSite;

		return new SiteFacts({
			sites,
			siteUrl: first.url,
			cloudId: first.cloudId,
		});
	}

	/** Whether neither the site nor the cloud id is known. */
	get isEmpty(): boolean {
		return this.siteUrl === undefined && this.cloudId === undefined;
	}

	/** Whether both the site and the cloud id are known, so nothing is left to learn. */
	get isComplete(): boolean {
		return this.siteUrl !== undefined && this.cloudId !== undefined;
	}

	/**
	 * Select one of the known sites as the default.
	 * @param cloudId - the site to work with.
	 * @returns the facts with that site selected, or undefined when it is not known.
	 */
	withSelection(cloudId: string): SiteFacts | undefined {
		const site = this.sites.find((candidate) => candidate.cloudId === cloudId);

		if (site === undefined) return undefined;

		return new SiteFacts({
			sites: this.sites,
			siteUrl: site.url,
			cloudId: site.cloudId,
		});
	}

	/** The URL of one site, when the account's list named it. */
	urlOf(cloudId: string | undefined): string | undefined {
		if (cloudId === undefined) return this.siteUrl;

		const known = this.sites.find((site) => site.cloudId === cloudId);

		if (known !== undefined) return known.url;

		return cloudId === this.cloudId ? this.siteUrl : undefined;
	}
}

/** How Atlassian's own site list is read, merged, and remembered. */
export const siteFacts: FactsReader<SiteFacts> = {
	toolName: SITE_TOOL,
	from: (grant) => SiteFacts.from(grant),
	parse: (value) => SiteFacts.parse(value),
	merge: (known, learned) => {
		const sites = mergeSites(learned.sites, known?.sites ?? []);
		const selected =
			known?.cloudId !== undefined
				? sites.find((site) => site.cloudId === known.cloudId)
				: undefined;

		return new SiteFacts({
			sites,
			siteUrl: selected?.url ?? learned.siteUrl ?? known?.siteUrl,
			cloudId: selected?.cloudId ?? learned.cloudId ?? known?.cloudId,
		});
	},
	remember: (facts) => ({
		...(facts.siteUrl === undefined ? {} : { siteUrl: facts.siteUrl }),
		...(facts.cloudId === undefined ? {} : { cloudId: facts.cloudId }),
		...(facts.sites.length === 0
			? {}
			: {
					sites: facts.sites.map(
						(site): JsonValue => ({ url: site.url, cloudId: site.cloudId }),
					),
				}),
	}),
};

/** The learned list first, then whatever the stored list adds. */
function mergeSites(
	learned: readonly AtlassianSite[],
	known: readonly AtlassianSite[],
): readonly AtlassianSite[] {
	const merged = [...learned];

	for (const site of known) {
		if (merged.some((candidate) => candidate.cloudId === site.cloudId))
			continue;

		merged.push(site);
	}

	return merged.slice(0, MAX_SITES);
}

/** The stored site list, when the record carries one this version understands. */
function sitesOf(value: JsonValue | undefined): readonly AtlassianSite[] {
	if (!Array.isArray(value)) return [];

	const sites: AtlassianSite[] = [];

	for (const item of value) {
		const record = asRecord(item);
		if (record === undefined) continue;

		const url = stringOf(record.url);
		const cloudId = stringOf(record.cloudId);

		if (url === undefined || cloudId === undefined) continue;
		if (sites.some((site) => site.cloudId === cloudId)) continue;

		sites.push({ url, cloudId });
	}

	return sites;
}

function stringOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: undefined;
}

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/u, "");
}

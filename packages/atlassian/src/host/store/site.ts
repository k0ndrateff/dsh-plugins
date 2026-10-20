/**
 * The Atlassian site this installation works with.
 *
 * Atlassian withholds `webUrl` from clients it does not recognize by name, so
 * the account's own list of sites is what gives a card a link and every Jira
 * and Confluence tool call the cloud id it requires. The facts are read once,
 * remembered in the credential record, and restored on the next start.
 */

import type { FactsReader } from "dsh-integration-host";
import { asRecord, type Grant, mcpText, pickString } from "dsh-mcp-oauth";

/** The tool whose answer names the account's site. */
export const SITE_TOOL = "getAccessibleAtlassianResources";

export class SiteFacts {
	readonly siteUrl?: string;
	readonly cloudId?: string;

	constructor(params: { siteUrl?: string; cloudId?: string }) {
		this.siteUrl = params.siteUrl;
		this.cloudId = params.cloudId;
	}

	/** What the stored grant already knows, if anything. */
	static from(grant: Grant | undefined): SiteFacts {
		const extra = grant?.extra;

		return new SiteFacts({
			...(typeof extra?.siteUrl === "string" ? { siteUrl: extra.siteUrl } : {}),
			...(typeof extra?.cloudId === "string" ? { cloudId: extra.cloudId } : {}),
		});
	}

	/**
	 * Read the first site of an account's own list.
	 * @param value - the result of `getAccessibleAtlassianResources`.
	 * @returns the facts it names, or empty facts when it names none.
	 */
	static parse(value: unknown): SiteFacts {
		for (const text of mcpText(value)) {
			const sites = parseJson(text);
			const record = asRecord(Array.isArray(sites) ? sites[0] : undefined);

			if (record === undefined) continue;

			const url = pickString(record, "url");
			const id = pickString(record, "id");

			if (url === undefined && id === undefined) continue;

			return new SiteFacts({
				...(url === undefined ? {} : { siteUrl: url.replace(/\/+$/u, "") }),
				...(id === undefined ? {} : { cloudId: id }),
			});
		}

		return new SiteFacts({});
	}

	/** Whether neither the site nor the cloud id is known. */
	get isEmpty(): boolean {
		return this.siteUrl === undefined && this.cloudId === undefined;
	}

	/** Whether both the site and the cloud id are known, so nothing is left to learn. */
	get isComplete(): boolean {
		return this.siteUrl !== undefined && this.cloudId !== undefined;
	}
}

/** How Atlassian's own site list is read, merged, and remembered. */
export const siteFacts: FactsReader<SiteFacts> = {
	toolName: SITE_TOOL,
	from: (grant) => SiteFacts.from(grant),
	parse: (value) => SiteFacts.parse(value),
	merge: (known, learned) =>
		new SiteFacts({
			siteUrl: learned.siteUrl ?? known?.siteUrl,
			cloudId: learned.cloudId ?? known?.cloudId,
		}),
	remember: (facts) => ({
		...(facts.siteUrl === undefined ? {} : { siteUrl: facts.siteUrl }),
		...(facts.cloudId === undefined ? {} : { cloudId: facts.cloudId }),
	}),
};

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

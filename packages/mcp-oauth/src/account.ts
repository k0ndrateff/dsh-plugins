/**
 * Which account of one provider a credential record belongs to.
 *
 * A plugin may hold several accounts of the same provider — a work GitLab and a
 * personal one, or two Atlassian sites — and the credential store addresses a
 * record as `<scope>/<id>`, so the account has to live inside the id half. The
 * default account keeps the id `mcp` that records were first written with,
 * which is what makes accounts additive: a grant stored before they existed
 * still resolves to the default one.
 */

import type { CredentialRecordEntry } from "@deepseek-ai/dsh-credentials";

/** The account a provider uses when its plugin names none. */
export const DEFAULT_INSTANCE = "default";

/** What an account name may be: one credential-key segment. */
const INSTANCE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The record id one account owns. */
const idFor = (instance: string): string =>
	instance === DEFAULT_INSTANCE ? "mcp" : `mcp-${instance}`;

/** The account an id names, or undefined for an id this plugin never wrote. */
const instanceFor = (id: string): string | undefined => {
	if (id === "mcp") return DEFAULT_INSTANCE;

	if (!id.startsWith("mcp-")) return undefined;

	const instance = id.slice("mcp-".length);

	return INSTANCE_PATTERN.test(instance) ? instance : undefined;
};

/**
 * The credential record key of one provider account.
 * @param scope - the owning plugin's registered name.
 * @param instance - the account within it; the default one unless named.
 * @throws TypeError when either segment is not a lowercase hyphenated identifier,
 *   which is the grammar the credential store admits.
 */
export function credentialKeyFor(
	scope: string,
	instance: string = DEFAULT_INSTANCE,
): string {
	for (const segment of [scope, instance])
		if (!INSTANCE_PATTERN.test(segment))
			throw new TypeError(
				`credential key segment "${segment}" must match ${String(INSTANCE_PATTERN)}`,
			);

	return `${scope}/${idFor(instance)}`;
}

/**
 * The account a stored record key names.
 * @param scope - the owning plugin's registered name.
 * @param key - a record key in the store's `<scope>/<id>` grammar.
 * @returns the account, or undefined for a key another plugin owns and for an
 *   id this plugin never wrote.
 */
export function instanceOfKey(scope: string, key: string): string | undefined {
	const [keyScope, id] = key.split("/");

	if (keyScope !== scope || id === undefined) return undefined;

	return instanceFor(id);
}

/**
 * The accounts a plugin holds records for.
 * @param scope - the owning plugin's registered name.
 * @param records - every stored record, as the credential seam lists them.
 * @returns one account name per record, in the store's own order.
 */
export function instancesOf(
	scope: string,
	records: readonly CredentialRecordEntry[],
): string[] {
	const instances: string[] = [];

	for (const record of records) {
		const instance = instanceOfKey(scope, record.key);

		if (instance !== undefined && !instances.includes(instance))
			instances.push(instance);
	}

	return instances;
}

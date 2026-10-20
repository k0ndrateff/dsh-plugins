/**
 * The account facts an integration learns from its own MCP server.
 *
 * Every remote MCP server names the account somewhere — Sentry lists
 * organizations, Atlassian lists sites — and later calls need that name. The
 * facts are learned once, remembered in the credential record, and restored on
 * the next start; this is the shape of that exchange, and it is the only thing
 * the shared auth knows about a provider's own vocabulary.
 */

import type { Grant, JsonValue } from "dsh-mcp-oauth";

/** One provider's facts, as a value it can test and merge. */
export interface AccountFacts {
	/** Whether nothing at all is known yet. */
	readonly isEmpty: boolean;
	/** Whether everything this provider needs is known. */
	readonly isComplete: boolean;
}

/** How one provider reads, merges, and remembers its own facts. */
export interface FactsReader<TFacts extends AccountFacts> {
	/** The MCP tool whose answer names the account. */
	readonly toolName: string;
	/** What the stored grant already knows, if anything. */
	from(grant: Grant | undefined): TFacts;
	/** Read the tool's answer. */
	parse(value: unknown): TFacts;
	/** Take whatever the learned facts add, keeping what is already known. */
	merge(known: TFacts | undefined, learned: TFacts): TFacts;
	/** The fields to keep in the credential record. */
	remember(facts: TFacts): Record<string, JsonValue>;
}

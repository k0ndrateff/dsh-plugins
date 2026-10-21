/**
 * The turn-scoped card one integration's `present` tool shows.
 *
 * This definition publishes the card the tool asked to show against its Turn, so
 * the turn tail renders it under the closing prose. Nothing extra is written to
 * the session: the card is narrowed from the tool result's persisted
 * `presentationMeta`, which means Session-log replay reproduces it exactly, with
 * no host-side record and no extra durable vocabulary.
 *
 * The call's own Tool-group cell stays with the generic keyed tool view, so this
 * module contributes only the turn-level card.
 */

import type {
	ConversationLocationData,
	ConversationMatch,
	ConversationNodeDefinition,
	ConversationTurnDataMap,
	TurnLocation,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { CardProvider } from "./types";

/** One card plus the log position it settled at. */
export interface PresentedCard<TCard> {
	readonly card: TCard;
	readonly seq: number;
}

/** Immutable cards published against one Turn. */
export interface PresentationTurnData<TCard> {
	readonly presentations: readonly PresentedCard<TCard>[];
}

/**
 * Turn-tail owner currency this seat reads.
 *
 * Structurally equal to ui-chat's `TurnTailOwnerProps`; the fields are named
 * locally so this module depends only on the conversation contract.
 */
export interface PresentationTurnOwner {
	readonly turn: TurnLocation;
	readonly seq: number;
}

/** One in-window root call head, kept so its result can be attributed. */
interface PresentCall {
	readonly name: string;
}

/** The state the definition accumulates for one Turn. */
export interface PresentationTurnState<TCard> {
	readonly turn: number;
	readonly calls: ReadonlyMap<string, PresentCall>;
	readonly presentations: readonly PresentedCard<TCard>[];
}

/** A location value this definition published earlier, read back for identity. */
interface PriorTurnData<TCard> {
	readonly kind: string;
	readonly turn: number;
	readonly key: string;
	readonly value: PresentationTurnData<TCard>;
}

/** What one integration's card is, on the wire and on the page. */
export interface PresentationSpec<
	TCard,
	K extends Extract<keyof ConversationTurnDataMap, string>,
	TOwner = unknown,
> {
	/** The Turn-data key this card publishes under. */
	readonly turnDataKey: K;
	/** The wire name whose settled result carries one card. */
	readonly toolName: string;
	/**
	 * How many of this kind's cards one Turn keeps.
	 *
	 * `all` (the default) is for a card that shows a *thing* the reader asked to
	 * see: two searches in one Turn are two answers, and each keeps its place.
	 * `last` is for a card that reports a *state*: a second run supersedes the
	 * first, and a wall of them buries the one that is current.
	 */
	readonly keep?: "all" | "last";
	/** Narrow one tool result's `meta`. */
	parse(value: unknown): TCard | undefined;
	/** How the card draws itself. */
	readonly card: CardProvider<TCard, TOwner>;
}

/** One integration's card, as its plugin registers and renders it. */
export interface PresentationType<TCard, TOwner = unknown> {
	/** The definition the conversation registry takes. */
	readonly definition: ConversationNodeDefinition<PresentationTurnState<TCard>>;
	/** The cards one closing Turn asked to show. */
	select(owner: PresentationTurnOwner): PresentationTurnData<TCard> | null;
	/** How the card draws itself. */
	readonly card: CardProvider<TCard, TOwner>;
}

/** The tool-call id a settled result answers, when the event carries one. */
const resultCallId = (match: ConversationMatch): string | undefined => {
	if (match.event.type !== "tool/result") return undefined;

	const source = match.event.data.message.source as { callId?: unknown };
	return typeof source.callId === "string" ? source.callId : undefined;
};

/**
 * Build one integration's card definition and its turn-tail reader.
 * @param spec - the wire name, the Turn-data key, the payload narrowing, and the card's own drawing rules.
 */
export const createPresentationType = <
	TCard,
	K extends Extract<keyof ConversationTurnDataMap, string>,
	TOwner = unknown,
>(
	spec: PresentationSpec<TCard, K, TOwner>,
): PresentationType<TCard, TOwner> => {
	/**
	 * Select the cards one Turn asked to show.
	 *
	 * The bound is the Turn's own end rather than the closing Assistant text, so
	 * a card recorded after a failed request or a user stop still belongs to its
	 * Turn.
	 */
	const select = (
		owner: PresentationTurnOwner,
	): PresentationTurnData<TCard> | null => {
		const data = owner.turn.data.get(spec.turnDataKey) as
			| Readonly<PresentationTurnData<TCard>>
			| undefined;
		if (data === undefined) return null;

		const bound = owner.turn.end?.seq ?? owner.seq;
		const presentations = data.presentations.filter(
			(presentation) => presentation.seq <= bound,
		);

		return presentations.length === 0 ? null : { presentations };
	};

	const definition: ConversationNodeDefinition<PresentationTurnState<TCard>> = {
		kind: spec.turnDataKey,
		match: (event) => {
			if (event.type === "turn/start")
				return { id: String(event.data.turn), role: "start" };

			// Every call head is remembered, so a result can be attributed to its
			// tool: the result itself carries only the call id, not the name.
			if (event.type === "tool/call" || event.type === "tool/result")
				return { id: String(event.data.turn), role: "update" };

			return null;
		},
		start: (_context, match) => {
			if (match.event.type !== "turn/start")
				throw new Error(`${spec.turnDataKey} start requires turn/start`);

			return {
				turn: match.event.data.turn,
				calls: new Map<string, PresentCall>(),
				presentations: [],
			};
		},
		update: (context, match) => {
			if (match.event.type === "tool/call") {
				const calls = new Map(context.state.calls);
				calls.set(String(match.event.data.callId), {
					name: match.event.data.name,
				});

				return { ...context.state, calls };
			}

			if (match.event.type !== "tool/result") return context.state;
			if (match.event.data.message.isError === true) return context.state;

			const callId = resultCallId(match);
			if (callId === undefined) return context.state;
			if (context.state.calls.get(callId)?.name !== spec.toolName)
				return context.state;

			const card = spec.parse(match.event.data.meta);
			if (card === undefined) return context.state;

			const present = { card, seq: match.event.seq };

			return {
				...context.state,
				presentations:
					spec.keep === "last"
						? [present]
						: [...context.state.presentations, present],
			};
		},
		buildLocationData: (context, scope, previous) => {
			if (scope !== "turn" || context.state === undefined) return null;

			const prior = previous as PriorTurnData<TCard> | null;

			if (
				prior?.kind === "turn" &&
				prior.turn === context.state.turn &&
				prior.key === spec.turnDataKey &&
				prior.value.presentations === context.state.presentations
			)
				return previous;

			// The key belongs to the plugin, and only its declaration-merged map
			// entry types the value under it; the library cannot name that entry.
			return {
				kind: "turn",
				turn: context.state.turn,
				key: spec.turnDataKey,
				value: { presentations: context.state.presentations },
			} as unknown as ConversationLocationData;
		},
	};

	return { definition, select, card: spec.card };
};

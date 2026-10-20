/**
 * The turn-scoped card behind `sentry_present`.
 *
 * This definition publishes the card the tool asked to show against its Turn, so
 * the turn tail renders it under the closing prose. Nothing extra is written to
 * the session: the card is narrowed from the tool result's persisted
 * `presentationMeta`, which means Session-log replay reproduces it exactly, with
 * no host-side record and no extra durable vocabulary.
 *
 * It is structurally the node definition the Atlassian plugin publishes for its
 * own cards; M4 lifts the shared half into `dsh-integration-ui`.
 */

import type {
	ConversationMatch,
	ConversationNodeDefinition,
	TurnLocation,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
	asSentryPresentation,
	type SentryPresentation,
} from "../../shared/meta";

/** The wire name whose settled result carries one card. */
export const SENTRY_TOOL_NAME = "sentry_present";

/** The Turn-data key the tail reads. */
export const SENTRY_TURN_DATA_KEY = "sentry-presented";

/** One card plus the log position it settled at. */
export interface PresentedCard extends SentryPresentation {
	readonly seq: number;
}

/** Immutable cards published against one Turn. */
export interface PresentationTurnData {
	readonly presentations: readonly PresentedCard[];
}

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Cards `sentry_present` asked to show in this Turn, in call order. */
		"sentry-presented": PresentationTurnData;
	}
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

interface PresentationTurnState {
	readonly turn: number;
	readonly calls: ReadonlyMap<string, PresentCall>;
	readonly presentations: readonly PresentedCard[];
}

/** The tool-call id a settled result answers, when the event carries one. */
const resultCallId = (match: ConversationMatch): string | undefined => {
	if (match.event.type !== "tool/result") return undefined;

	const source = match.event.data.message.source as { callId?: unknown };
	return typeof source.callId === "string" ? source.callId : undefined;
};

/**
 * Select the cards one Turn asked to show.
 *
 * The bound is the Turn's own end rather than the closing Assistant text, so a
 * card recorded after a failed request or a user stop still belongs to its Turn.
 * @param owner - the closing Turn and its sequence.
 * @returns the cards, or null when the Turn showed none.
 */
export function selectPresentations(
	owner: PresentationTurnOwner,
): PresentationTurnData | null {
	const data = owner.turn.data.get(SENTRY_TURN_DATA_KEY);
	if (data === undefined) return null;

	const bound = owner.turn.end?.seq ?? owner.seq;
	const presentations = data.presentations.filter(
		(presentation) => presentation.seq <= bound,
	);

	return presentations.length === 0 ? null : { presentations };
}

/** One card per settled `sentry_present` call; publishes no view node. */
export const sentryDefinition: ConversationNodeDefinition<PresentationTurnState> =
	{
		kind: SENTRY_TURN_DATA_KEY,
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
				throw new Error("sentry-presented start requires turn/start");

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
			if (context.state.calls.get(callId)?.name !== SENTRY_TOOL_NAME)
				return context.state;

			const presentation = asSentryPresentation(match.event.data.meta);
			if (presentation === undefined) return context.state;

			return {
				...context.state,
				presentations: [
					...context.state.presentations,
					{ ...presentation, seq: match.event.seq },
				],
			};
		},
		buildLocationData: (context, scope, previous) => {
			if (scope !== "turn" || context.state === undefined) return null;

			if (
				previous?.kind === "turn" &&
				previous.turn === context.state.turn &&
				previous.key === SENTRY_TURN_DATA_KEY &&
				previous.value.presentations === context.state.presentations
			)
				return previous;

			return {
				kind: "turn",
				turn: context.state.turn,
				key: SENTRY_TURN_DATA_KEY,
				value: { presentations: context.state.presentations },
			};
		},
	};

/**
 * The turn-scoped card behind `checks`.
 *
 * This definition publishes the run the tool reported against its Turn, so the
 * turn tail draws it under the closing prose. Nothing extra is written to the
 * session: the card is narrowed from the tool result's persisted
 * `presentationMeta`, which means Session-log replay reproduces it exactly.
 *
 * It is structurally the node definition the Atlassian plugin publishes for its
 * own cards; M4 lifts the shared half into `dsh-integration-ui`.
 */

import type {
	ConversationMatch,
	ConversationNodeDefinition,
	TurnLocation,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { asChecksCard, type ChecksCard } from "../../shared/checks";

/** The wire name whose settled result carries one run. */
export const CHECKS_TOOL_NAME = "checks";

/** The Turn-data key the tail reads. */
export const CHECKS_TURN_DATA_KEY = "devkit-checks";

/** One run plus the log position it settled at. */
export interface CheckedRun extends ChecksCard {
	readonly seq: number;
}

/** Immutable runs published against one Turn. */
export interface ChecksTurnData {
	readonly runs: readonly CheckedRun[];
}

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		/** Runs `checks` reported in this Turn, in call order. */
		"devkit-checks": ChecksTurnData;
	}
}

/**
 * Turn-tail owner currency this seat reads.
 *
 * Structurally equal to ui-chat's `TurnTailOwnerProps`; the fields are named
 * locally so this module depends only on the conversation contract.
 */
export interface ChecksTurnOwner {
	readonly turn: TurnLocation;
	readonly seq: number;
}

/** One in-window root call head, kept so its result can be attributed. */
interface CallHead {
	readonly name: string;
}

interface ChecksTurnState {
	readonly turn: number;
	readonly calls: ReadonlyMap<string, CallHead>;
	readonly runs: readonly CheckedRun[];
}

/** The tool-call id a settled result answers, when the event carries one. */
const resultCallId = (match: ConversationMatch): string | undefined => {
	if (match.event.type !== "tool/result") return undefined;

	const source = match.event.data.message.source as { callId?: unknown };
	return typeof source.callId === "string" ? source.callId : undefined;
};

/**
 * Select the runs one Turn reported.
 *
 * The bound is the Turn's own end rather than the closing Assistant text, so a
 * run recorded after a failed request or a user stop still belongs to its Turn.
 * @param owner - the closing Turn and its sequence.
 * @returns the runs, or null when the Turn ran no check.
 */
export function selectRuns(owner: ChecksTurnOwner): ChecksTurnData | null {
	const data = owner.turn.data.get(CHECKS_TURN_DATA_KEY);
	if (data === undefined) return null;

	const bound = owner.turn.end?.seq ?? owner.seq;
	const runs = data.runs.filter((run) => run.seq <= bound);

	return runs.length === 0 ? null : { runs };
}

/** One card per settled `checks` call; publishes no view node. */
export const checksDefinition: ConversationNodeDefinition<ChecksTurnState> = {
	kind: CHECKS_TURN_DATA_KEY,
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
			throw new Error("devkit-checks start requires turn/start");

		return {
			turn: match.event.data.turn,
			calls: new Map<string, CallHead>(),
			runs: [],
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
		if (context.state.calls.get(callId)?.name !== CHECKS_TOOL_NAME)
			return context.state;

		const card = asChecksCard(match.event.data.meta);
		if (card === undefined) return context.state;

		return {
			...context.state,
			runs: [...context.state.runs, { ...card, seq: match.event.seq }],
		};
	},
	buildLocationData: (context, scope, previous) => {
		if (scope !== "turn" || context.state === undefined) return null;

		if (
			previous?.kind === "turn" &&
			previous.turn === context.state.turn &&
			previous.key === CHECKS_TURN_DATA_KEY &&
			previous.value.runs === context.state.runs
		)
			return previous;

		return {
			kind: "turn",
			turn: context.state.turn,
			key: CHECKS_TURN_DATA_KEY,
			value: { runs: context.state.runs },
		};
	},
};

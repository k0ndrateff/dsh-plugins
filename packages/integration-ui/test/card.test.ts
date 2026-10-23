/**
 * The turn-card state machine against scripted events.
 *
 * The card is the one piece of the browser shell that has real logic: which
 * calls count, which results belong to them, what a replay of the same session
 * reproduces, and which cards a closing Turn shows. All of it is pure, so it is
 * checked here rather than by opening a page.
 *
 *   bun run test/card.ts
 */

import { expect, test } from "bun:test";
import type {
	ConversationMatch,
	ConversationNodeContext,
	ConversationStartMatch,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
	createPresentationType,
	type PresentationTurnData,
	type PresentationTurnOwner,
	type PresentationTurnState,
	type PresentedCard,
} from "../src/card/definition";
import type { CardProvider } from "../src/card/types";

declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
	interface ConversationTurnDataMap {
		"test-presented": PresentationTurnData<TestCard>;
	}
}

/** A labelled assertion; the test name says the scenario. */
const check = (label: string, ok: boolean, detail = ""): void => {
	expect(ok, detail === "" ? label : `${label} — ${detail}`).toBe(true);
};

/** One card payload, as the test tool publishes it. */
interface TestCard {
	readonly callId: string;
	readonly title?: string;
	readonly items: readonly string[];
}

/** How the test integration draws its card. */
const card: CardProvider<TestCard> = {
	callId: (value) => value.callId,
	title: (value) => value.title,
	count: (value) => `${value.items.length} items`,
	length: (value) => value.items.length,
	layout: () => "list",
	items: (value) => value.items.join(","),
};

const parseCard = (value: unknown): TestCard | undefined => {
	if (value === null || typeof value !== "object") return undefined;

	const candidate = value as Partial<TestCard>;
	if (typeof candidate.callId !== "string" || !Array.isArray(candidate.items))
		return undefined;

	return {
		callId: candidate.callId,
		...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
		items: candidate.items.filter(
			(item): item is string => typeof item === "string",
		),
	};
};

const type = createPresentationType<TestCard, "test-presented">({
	turnDataKey: "test-presented",
	toolName: "test_present",
	parse: parseCard,
	card,
});

const definition = type.definition;

/** One event, as far as the definition reads it. */
const match = (event: unknown, role: "start" | "update"): ConversationMatch =>
	({
		event,
		role,
		location: { kind: "session" },
	}) as unknown as ConversationMatch;

const startEvent = (turn: number): ConversationStartMatch =>
	match(
		{ type: "turn/start", data: { turn }, seq: 1 },
		"start",
	) as ConversationStartMatch;

const callEvent = (
	turn: number,
	callId: string,
	name: string,
	seq: number,
): ConversationMatch =>
	match({ type: "tool/call", data: { turn, callId, name }, seq }, "update");

const resultEvent = (
	turn: number,
	callId: string,
	meta: unknown,
	seq: number,
	isError = false,
): ConversationMatch =>
	match(
		{
			type: "tool/result",
			data: { turn, message: { isError, source: { callId } }, meta },
			seq,
		},
		"update",
	);

const startContext = (): ConversationNodeContext<
	PresentationTurnState<TestCard>
> =>
	({ state: undefined }) as unknown as ConversationNodeContext<
		PresentationTurnState<TestCard>
	>;

const context = (
	state: PresentationTurnState<TestCard>,
): ConversationNodeContext<PresentationTurnState<TestCard>> & {
	readonly state: PresentationTurnState<TestCard>;
} =>
	({ state }) as unknown as ConversationNodeContext<
		PresentationTurnState<TestCard>
	> & { readonly state: PresentationTurnState<TestCard> };

const reader = {
	previous: () => undefined,
} as never;

/** Start one turn's state. */
const started = (turn: number): PresentationTurnState<TestCard> =>
	definition.start(startContext(), startEvent(turn), reader);

/** Apply one update to a state. */
const updated = (
	state: PresentationTurnState<TestCard>,
	event: ConversationMatch,
): PresentationTurnState<TestCard> => definition.update(context(state), event);

const CARD: TestCard = { callId: "c1", title: "Found", items: ["a", "b"] };

test("one settled call", () => {
	const state = updated(
		updated(started(7), callEvent(7, "c1", "test_present", 3)),
		resultEvent(7, "c1", CARD, 4),
	);

	check(
		"a result of this tool's call becomes a card",
		state.presentations.length === 1 &&
			state.presentations[0]?.card.callId === "c1" &&
			state.presentations[0]?.seq === 4,
		JSON.stringify(state.presentations),
	);

	const location = definition.buildLocationData?.(context(state), "turn", null);

	check(
		"the card is published against its Turn under this plugin's key",
		location?.kind === "turn" && location.key === "test-presented",
		JSON.stringify(location)?.slice(0, 80),
	);

	const published =
		location?.kind === "turn" && location.key === "test-presented"
			? location.value
			: undefined;

	check(
		"publishing again with the same list keeps the previous value",
		definition.buildLocationData?.(context(state), "turn", location ?? null) ===
			location,
	);

	const store = {
		get: (key: string) =>
			location?.kind === "turn" && location.key === key ? published : undefined,
	};

	const owner = {
		turn: { data: store, end: { seq: 10 } },
		seq: 10,
	} as unknown as PresentationTurnOwner;

	check(
		"the tail reads the card back",
		type.select(owner)?.presentations[0]?.card.callId === "c1",
		JSON.stringify(
			type.select(owner)?.presentations.map((item) => item.card.callId),
		),
	);

	const closed = {
		turn: { data: store, end: { seq: 3 } },
		seq: 3,
	} as unknown as PresentationTurnOwner;

	check(
		"a card recorded after the Turn's own end is not shown",
		type.select(closed) === null,
		JSON.stringify(type.select(closed)),
	);
});

test("what does not become a card", () => {
	const other = updated(
		updated(started(7), callEvent(7, "c2", "another_tool", 3)),
		resultEvent(7, "c2", CARD, 4),
	);

	check(
		"a result of another tool's call is not this card",
		other.presentations.length === 0,
		String(other.presentations.length),
	);

	const failed = updated(
		updated(started(7), callEvent(7, "c3", "test_present", 3)),
		resultEvent(7, "c3", CARD, 4, true),
	);

	check(
		"a failed call shows no card",
		failed.presentations.length === 0,
		String(failed.presentations.length),
	);

	const unparsable = updated(
		updated(started(7), callEvent(7, "c4", "test_present", 3)),
		resultEvent(7, "c4", { nope: true }, 4),
	);

	check(
		"a payload this version cannot read shows no card",
		unparsable.presentations.length === 0,
		String(unparsable.presentations.length),
	);

	const unknownCall = updated(started(7), resultEvent(7, "c5", CARD, 4));

	check(
		"a result whose call was never seen is not attributed",
		unknownCall.presentations.length === 0,
		String(unknownCall.presentations.length),
	);
});

test("two cards in one turn", () => {
	let state = started(7);

	state = updated(state, callEvent(7, "c1", "test_present", 3));
	state = updated(state, callEvent(7, "c2", "test_present", 5));
	state = updated(state, resultEvent(7, "c1", CARD, 6));
	state = updated(
		state,
		resultEvent(7, "c2", { callId: "c2", items: ["z"] }, 7),
	);

	check(
		"both cards are kept, in call order",
		state.presentations.length === 2 &&
			state.presentations[0]?.card.callId === "c1" &&
			state.presentations[1]?.card.callId === "c2",
		JSON.stringify(state.presentations.map((item) => item.card.callId)),
	);

	const location = definition.buildLocationData?.(context(state), "turn", null);
	const published =
		location?.kind === "turn" && location.key === "test-presented"
			? location.value
			: undefined;

	check(
		"both cards are published together",
		published?.presentations.length === 2,
		String(published?.presentations.length),
	);
});

test("a card that reports a state, not a thing", () => {
	const latest = createPresentationType<TestCard, "test-presented">({
		turnDataKey: "test-presented",
		toolName: "test_present",
		keep: "last",
		parse: parseCard,
		card,
	});
	let state = latest.definition.start(startContext(), startEvent(9), reader);

	state = latest.definition.update(
		context(state),
		callEvent(9, "c1", "test_present", 3),
	);
	state = latest.definition.update(
		context(state),
		callEvent(9, "c2", "test_present", 5),
	);
	state = latest.definition.update(
		context(state),
		resultEvent(9, "c1", CARD, 6),
	);
	state = latest.definition.update(
		context(state),
		resultEvent(9, "c2", { callId: "c2", items: ["z"] }, 7),
	);

	check(
		"the newest run is the one the turn keeps",
		state.presentations.length === 1 &&
			state.presentations[0]?.card.callId === "c2" &&
			state.presentations[0]?.seq === 7,
		JSON.stringify(state.presentations.map((item) => item.card.callId)),
	);
});

test("the card's own drawing rules", () => {
	const presented: PresentedCard<TestCard> = { card: CARD, seq: 4 };

	check(
		"the heading and the count come from the payload",
		card.title(presented.card) === "Found" &&
			card.count(presented.card) === "2 items" &&
			card.length(presented.card) === 2,
		`${String(card.title(presented.card))} / ${card.count(presented.card)}`,
	);
});

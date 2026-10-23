/**
 * Which colour an issue's type and priority earn on a card.
 *
 * Atlassian serves these as free text in whatever language the site is set to —
 * this one answers "Задача", "Баг" and a priority of "Р3" — so the mapping is
 * by name, in both languages. The Cyrillic letters that look Latin ("Р3",
 * "С1") are folded before the second lookup, because a homoglyph is a spelling
 * of the same scheme value rather than a different one.
 *
 * An unrecognized name is a neutral fact rather than a guess: a wrong colour is
 * worse than no colour. The union matches `TagTone` structurally, so this
 * module stays free of any browser dependency.
 */

/** The palettes the harness's `Tag` can render. */
export type CardTone =
	| "outline"
	| "solid"
	| "neutral"
	| "quiet"
	| "success"
	| "info"
	| "warning"
	| "danger";

/** Issue types this version knows, as sites spell them. */
const TYPE_TONES: Readonly<Record<string, CardTone>> = {
	bug: "danger",
	defect: "danger",
	баг: "danger",
	ошибка: "danger",
	story: "success",
	"user story": "success",
	история: "success",
	feature: "success",
	improvement: "success",
	улучшение: "success",
	task: "info",
	задача: "info",
	// An epic is the container the others hang from, so it gets the one loud
	// palette: it should be recognizable at a glance in a mixed list.
	epic: "solid",
	эпик: "solid",
	question: "warning",
	вопрос: "warning",
	support: "warning",
	"sub-task": "quiet",
	subtask: "quiet",
	подзадача: "quiet",
};

/** Priority names and scheme values this version knows. */
const PRIORITY_TONES: Readonly<Record<string, CardTone>> = {
	p0: "danger",
	p1: "danger",
	blocker: "danger",
	blocking: "danger",
	highest: "danger",
	critical: "danger",
	критический: "danger",
	p2: "warning",
	high: "warning",
	major: "warning",
	высокий: "warning",
	блокирующий: "warning",
	// A low or medium priority is a quiet fact, not a status: text only.
	p3: "quiet",
	p4: "quiet",
	p5: "quiet",
	medium: "quiet",
	average: "quiet",
	normal: "quiet",
	low: "quiet",
	lowest: "quiet",
	minor: "quiet",
	trivial: "quiet",
	средний: "quiet",
	низкий: "quiet",
};

/** Cyrillic letters a Jira scheme may use in place of their Latin twins. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
	а: "a",
	в: "b",
	е: "e",
	к: "k",
	м: "m",
	н: "h",
	о: "o",
	р: "p",
	с: "c",
	т: "t",
	у: "y",
	х: "x",
};

/**
 * The palette for one issue type.
 * @param type - the type name as the site spells it.
 * @returns a palette; `neutral` for a type this version does not know.
 */
export const issueTypeTone = (type: string | undefined): CardTone => {
	return lookup(TYPE_TONES, type);
};

/**
 * The palette for one priority.
 * @param priority - the priority name or scheme value ("P2", "High", "Р4").
 * @returns a palette; `neutral` when the value is missing or unknown.
 */
export const priorityTone = (priority: string | undefined): CardTone => {
	return lookup(PRIORITY_TONES, priority);
};

/** Leading and trailing space, and case, are not part of a name. */
const lookup = (
	table: Readonly<Record<string, CardTone>>,
	value: string | undefined,
): CardTone => {
	const name = (value ?? "").trim().toLowerCase();

	if (name === "") return "neutral";

	return table[name] ?? table[fold(name)] ?? "neutral";
};

/** Read a name as if its lookalike letters were Latin. */
const fold = (name: string): string => {
	return name.replace(
		/[авекмнорстух]/gu,
		(letter) => HOMOGLYPHS[letter] ?? letter,
	);
};

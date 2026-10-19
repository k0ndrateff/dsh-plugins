/**
 * Compress the long text behind a card into the one line it can show.
 *
 * A Jira description is a page of context and a Confluence body is more, so the
 * card carries neither: it carries one sentence per item, written by the same
 * model the conversation runs on. That keeps the card informative without
 * turning it into a wall of text, and it costs one auxiliary call per card.
 *
 * Everything here is best-effort. No model route, no `llm` service, a slow or
 * failing provider — each of those drops the sentences and leaves the rest of
 * the card intact, because a card without a summary is still a useful card.
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-llm";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";

/** One item to compress, as the card already knows it. */
export interface GistTarget {
	/** The caller's own identity for the item; echoed back, never shown. */
	readonly id: string;
	/** The item's own heading: an issue summary or a page title. */
	readonly title: string;
	/** The long text to compress. */
	readonly body: string;
}

/** One sentence, tied back to the item it describes. */
export interface Gist {
	readonly id: string;
	readonly text: string;
}

/** The provider and model an auxiliary call should use. */
export interface GistRoute {
	readonly provider: string;
	readonly model: string;
}

export interface GistOptions {
	/** The turn's own route, or undefined when it could not be resolved. */
	readonly route: GistRoute | undefined;
	/** The tool call's signal; cancelling the call cancels the summary. */
	readonly signal: AbortSignal | undefined;
}

/** Longest body sent for one item. */
const MAX_BODY_CHARS = 900;

/** Longest prompt built in total; beyond this, bodies are dropped, titles stay. */
const MAX_PROMPT_CHARS = 12_000;

/** Longest sentence kept, so one runaway answer cannot stretch the card. */
const MAX_GIST_CHARS = 240;

/** A card is not worth waiting longer than this for. */
const TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
	"You write the one-line summary a card shows for each numbered item below.",
	"Each item is a Jira issue or a Confluence page; its text may be in any language.",
	"Answer with exactly one line per item, formatted `<number>: <sentence>`.",
	"Say what the item actually asks for or contains, in the item's own language.",
	"At most 25 words. No markdown, no quotes, no bullet characters, no preamble, no closing remarks.",
].join(" ");

/**
 * The provider and model the current turn runs on.
 *
 * The logged request header is the route the harness actually used; the agent's
 * own options are the fallback for a session whose header is not readable yet.
 * @param exec - the running tool call.
 * @returns the route, or undefined when neither source names a complete one.
 */
export function modelRoute(exec: ToolExecution): GistRoute | undefined {
	const config = exec.agent?.session.requestHeader()?.config;
	const provider = config?.provider ?? exec.agent?.options.provider;
	const model = config?.model ?? exec.agent?.options.model;

	if (provider === undefined || model === undefined) return undefined;
	if (provider === "" || model === "") return undefined;

	return { provider, model };
}

/**
 * Read the numbered sentences back out of one answer.
 *
 * Models decorate: a code fence, a "Here you go:", a bullet before the number.
 * Only lines that start with an in-range number are read, and the first line
 * for a number wins, so decoration is ignored rather than corrupting a gist.
 * @param text - the model's whole answer.
 * @param count - how many items were sent.
 * @returns one entry per item, in order; entries the model skipped are undefined.
 */
export function parseGists(
	text: string,
	count: number,
): (string | undefined)[] {
	const gists: (string | undefined)[] = new Array(count).fill(undefined);

	for (const line of text.split("\n")) {
		const match = line
			.trim()
			.replace(/^[-*•]\s*/u, "")
			.match(/^(\d{1,3})\s*[).:\-–—]\s*(.+)$/u);

		if (match === null) continue;

		const index = Number(match[1]) - 1;
		const sentence = match[2]
			?.replace(/^["'«“]+|["'»”]+$/gu, "")
			.replace(/\s+/gu, " ")
			.trim();

		if (index < 0 || index >= count) continue;
		if (gists[index] !== undefined) continue;
		if (sentence === undefined || sentence === "") continue;

		gists[index] = sentence.slice(0, MAX_GIST_CHARS);
	}

	return gists;
}

/**
 * Write one sentence about each item that has long text.
 * @param ctx - host context; the LLM service is read from it when present.
 * @param targets - the items to compress.
 * @param options - the turn's route and the running call's signal.
 * @returns the sentences, or undefined when the pass did not produce any.
 */
export async function summarizeGists(
	ctx: Context,
	targets: readonly GistTarget[],
	options: GistOptions,
): Promise<readonly Gist[] | undefined> {
	if (targets.length === 0) return undefined;

	const route = options.route;
	if (route === undefined) return undefined;

	// Read without an injection requirement: a deployment without a model must
	// still get its cards, just without the sentences.
	const llm = ctx.get("llm");
	if (llm === undefined) return undefined;

	const prompt = buildPrompt(targets);
	if (prompt === "") return undefined;

	const signal =
		options.signal === undefined
			? AbortSignal.timeout(TIMEOUT_MS)
			: AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]);

	let answer = "";

	try {
		const stream = llm.stream({
			provider: route.provider,
			model: route.model,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
			temperature: 0,
			signal,
		});

		for await (const chunk of stream) {
			if (chunk.type === "text-delta") answer += chunk.text;
		}
	} catch {
		// A failed or cancelled summary is not a failed card.
		return undefined;
	}

	const sentences = parseGists(answer, targets.length);
	const gists: Gist[] = [];

	targets.forEach((target, index) => {
		const sentence = sentences[index];

		if (sentence !== undefined) gists.push({ id: target.id, text: sentence });
	});

	return gists.length === 0 ? undefined : gists;
}

/** The numbered items, bounded so one card cannot become a book. */
function buildPrompt(targets: readonly GistTarget[]): string {
	const parts: string[] = [];
	let used = 0;

	targets.forEach((target, index) => {
		const heading = `${index + 1}. ${target.title}`;
		const room = MAX_PROMPT_CHARS - used - heading.length;

		// Over budget: keep the item's place in the numbering but drop its body,
		// so the sentences that do come back stay attached to the right item.
		const body =
			room <= 0 ? "" : target.body.slice(0, Math.min(room, MAX_BODY_CHARS));

		used += heading.length + body.length;
		parts.push(body === "" ? heading : `${heading}\n${body}`);
	});

	return parts.join("\n\n");
}

/**
 * What the user typed, as the reference a chain starts from.
 *
 * A provider names its own objects its own way, and the tool should accept that
 * name rather than a structure. So this reads the spelling a person or a model
 * would write — a Sentry short id, a commit sha, `group/project!12`, a tracker
 * key — and refuses anything it cannot place, with a sentence saying what was
 * expected instead of a chain that silently starts from the wrong object.
 *
 * An integration may resolve several kinds but *start* from one of them: naming
 * a GitLab merge request is the usual way in, while a commit sha is the way in
 * when the question is "which merge request contains this commit". So the read
 * tries the provider's entry kind first and then every other kind it resolves,
 * and a refusal lists them all.
 *
 * The rules are about the *shape* of an identifier, never about a provider: a
 * link is trimmed to its last path segment because that is where an id usually
 * lives, not because any particular site is known here.
 */

import type {
	CorrelationKind,
	CorrelationRef,
} from "dsh-integration-host/correlation";

/** A link somebody pasted, rather than an identifier. */
const LINK = /^https?:\/\/\S+$/u;

/** A commit sha, short or full. */
const SHA = /^[0-9a-f]{7,40}$/u;

/** A tracker key, such as `DEV-5977`. */
const TASK_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/u;

/** A change request as a code host spells it locally: `group/project!12`. */
const CHANGE = /^([^!\s]+)!(\d+)$/u;

/** The last path segment of a link, which is where an id usually lives. */
const lastSegment = (text: string): string => {
	const path = (text.split(/[?#]/u)[0] ?? "").replace(/\/+$/u, "");

	return path.split("/").filter(Boolean).pop() ?? "";
};

/** One spelling of one kind, as the tool reads it. */
const READERS: Record<CorrelationKind, (text: string) => CorrelationRef> = {
	error: (text) => {
		const id = LINK.test(text) ? lastSegment(text) : text;

		if (id === "") throw new Error(`"${text}" names no issue`);

		// A sha is a reference to a commit, and the walker can follow it once it
		// has started from the error; starting an error chain from one finds
		// nothing and looks like an outage.
		if (SHA.test(id))
			throw new Error(`"${text}" is a commit sha, not an issue id`);

		return { kind: "error", id };
	},
	commit: (text) => {
		const sha = (LINK.test(text) ? lastSegment(text) : text).toLowerCase();

		if (!SHA.test(sha))
			throw new Error(
				`"${text}" is not a commit sha; name the commit itself, not the branch or the file`,
			);

		return { kind: "commit", sha, ...(LINK.test(text) ? { url: text } : {}) };
	},
	change: (text) => {
		const match = CHANGE.exec(text);

		if (match?.[1] === undefined || match[2] === undefined)
			throw new Error(
				`"${text}" is not a change request; write it as the project path and its number, such as group/project!12`,
			);

		return { kind: "change", repository: match[1], number: match[2] };
	},
	task: (text) => {
		const key = text.toUpperCase();

		if (!TASK_KEY.test(key))
			throw new Error(
				`"${text}" is not a tracker key; write it as the key itself, such as DEV-5977`,
			);

		return { kind: "task", key };
	},
};

/** What one kind's identifiers look like, as a refusal names them. */
const ACCEPTS: Readonly<Record<CorrelationKind, string>> = {
	error: "a Sentry issue short id or link",
	commit: "a commit sha",
	change: "a merge request as group/project!12",
	task: "a tracker key such as DEV-5977",
};

/** The integration a chain starts from, as the registry describes it. */
export interface AnchorSpec {
	/** The provider's name, as the user typed it. */
	readonly provider: string;
	/** The kind a chain normally starts from for this provider. */
	readonly entry: CorrelationKind;
	/** Every kind this provider can resolve, which includes its entry. */
	readonly resolves: readonly CorrelationKind[];
}

/**
 * Read the reference a chain starts from.
 * @param spec - the integration the user named, and what it can start from.
 * @param text - what the user typed.
 * @throws when the text is not a spelling this integration starts from; the
 *   message names the spellings it does accept.
 */
export const anchorFor = (spec: AnchorSpec, text: string): CorrelationRef => {
	const trimmed = text.trim();

	if (trimmed === "") throw new Error("the reference is empty");

	const kinds = [
		spec.entry,
		...spec.resolves.filter((kind) => kind !== spec.entry),
	];
	let refusal = "";

	for (const kind of kinds) {
		try {
			return READERS[kind](trimmed);
		} catch (error) {
			refusal = refusal === "" ? (error as Error).message : refusal;
		}
	}

	throw new Error(
		`${spec.provider} starts a chain from ${kinds.map((kind) => ACCEPTS[kind]).join(" or ")}; ${refusal}`,
	);
};

/**
 * Which status changes an issue's current status admits.
 *
 * Sentry accepts `resolved`, `unresolved`, and `ignored` on any issue, so the
 * server would not refuse "Resolve" on an already-resolved issue — it would
 * write nothing and the panel would look broken. The set of buttons is
 * therefore chosen from the status the document was read with, and only the
 * applicable changes are offered.
 */

/** One status change Sentry's own vocabulary offers. */
export type IssueStatusAction = "resolve" | "ignore" | "reopen";

/** The label each action wears, including the hidden semantics of "Ignore". */
export const STATUS_ACTION_LABELS: Readonly<Record<IssueStatusAction, string>> =
	{
		resolve: "Resolve",
		ignore: "Ignore until it escalates",
		reopen: "Reopen",
	};

/**
 * The status changes that make sense for the issue's current status.
 *
 * An unknown status (an older payload, a vocabulary this version does not
 * know) offers all three rather than guessing which one is the no-op.
 * @param current - the status word the issue document carries.
 * @returns the applicable actions, in the order the panel shows them.
 */
export const applicableStatusActions = (
	current: string | undefined,
): readonly IssueStatusAction[] => {
	switch (current?.toLowerCase()) {
		case "resolved":
			return ["reopen", "ignore"];
		case "ignored":
			return ["reopen", "resolve"];
		case "unresolved":
			return ["resolve", "ignore"];
		default:
			return ["resolve", "ignore", "reopen"];
	}
};

/** One status word as a person reads it rather than as Sentry spells it. */
export const statusText = (value: string | undefined): string | undefined => {
	switch (value?.toLowerCase()) {
		case "unresolved":
			return "Unresolved";
		case "resolved":
			return "Resolved";
		case "ignored":
			return "Ignored";
		default:
			return value;
	}
};

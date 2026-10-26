/**
 * One panel write, and what to tell the reader about it.
 *
 * The shared panel body runs one write at a time and replaces the document with
 * the one the host answered; what it does not own is the wording. The button
 * that was pressed says what it is doing ("Starting…"), and the panel says what
 * changed once the server has confirmed it — otherwise a click that worked and a
 * click that did nothing look the same until the reader compares the document
 * with what they remember.
 */

import type { PanelActions } from "dsh-integration-ui";
import { useCallback, useEffect, useState } from "react";
import type { PanelTarget } from "../../shared/panel";

/** What one write is currently doing, and what it just did. */
export interface PanelWriter {
	/** The label of the action in flight, for the button that started it. */
	readonly pending: string | null;
	/** What the last finished write changed, or null before the first one. */
	readonly changed: string | null;
	/**
	 * Run one write.
	 * @param label - what the pressed control becomes while it runs.
	 * @param changed - what the panel says after the host confirmed the write.
	 * @param write - the call, which gets the panel's current target.
	 */
	run(
		label: string,
		changed: string,
		write: (target: PanelTarget) => Promise<unknown>,
	): void;
}

/**
 * Track the write in flight and the last confirmed change.
 * @param actions - the shared body's action set.
 * @param identity - what the panel is showing; a new item clears the note.
 * @returns the writer the panel's controls share.
 */
export const usePanelWriter = (
	actions: PanelActions<PanelTarget>,
	identity: string,
): PanelWriter => {
	const [pending, setPending] = useState<string | null>(null);
	const [changed, setChanged] = useState<string | null>(null);

	// Navigating the panel to another issue must not carry the previous issue's
	// confirmation into a document that was never written.
	useEffect(() => {
		setPending(null);
		setChanged(null);
	}, [identity]);

	const run = useCallback(
		(
			label: string,
			changedText: string,
			write: (target: PanelTarget) => Promise<unknown>,
		): void => {
			setPending(label);
			setChanged(null);

			actions.run(async (target) => {
				try {
					const answer = await write(target);

					setChanged(changedText);

					return answer;
				} finally {
					setPending(null);
				}
			});
		},
		[actions],
	);

	return { pending, changed, run };
};

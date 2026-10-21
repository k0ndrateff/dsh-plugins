/**
 * The checks card, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: a run of checks is an answer-shaped
 * artifact rather than a step in the work, so it belongs beneath the prose,
 * outside the collapsible tool group. The seat renders for every completed turn
 * and narrows its own turn; the definition keeps one run per turn — the newest —
 * because what a reader wants from a project's checks is where it stands now.
 */

import { createPresentationTail } from "dsh-integration-ui";
import { checksPresentation } from "../conversation/card-definition";

/**
 * Render the run one completed turn reported last.
 * @param props - the closing turn, its sequence, and the file opener.
 * @returns the card, or null for a turn that ran no check.
 */
export const ChecksTail = createPresentationTail(checksPresentation);

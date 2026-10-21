/**
 * The card `correlate` shows, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: a chain is an answer-shaped artifact
 * rather than a step in the work, so it belongs beneath the prose, outside the
 * collapsible tool group.
 */

import { createPresentationTail } from "dsh-integration-ui";
import { correlationPresentation } from "../conversation/card-definition";

/** Every card one completed turn asked to show. */
export const ChainTail = createPresentationTail(correlationPresentation);

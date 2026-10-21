/**
 * The card `digest` shows, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: the digest is an answer-shaped
 * artifact rather than a step in the work, so it belongs beneath the prose,
 * outside the collapsible tool group — which is also where it lands when a
 * scheduled reminder produced it.
 */

import { createPresentationTail } from "dsh-integration-ui";
import { digestPresentation } from "../conversation/card-definition";

/** Every card one completed turn asked to show. */
export const DigestTail = createPresentationTail(digestPresentation);

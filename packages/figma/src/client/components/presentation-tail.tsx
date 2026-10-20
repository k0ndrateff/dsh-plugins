/**
 * The card `figma_present` shows, under the closing text of its turn.
 *
 * A turn tail is the right seat for this: the card is an answer-shaped artifact
 * rather than a step in the work, so it belongs beneath the prose, outside the
 * collapsible tool group — the same place `present` puts its file cards. The
 * seat renders for every completed turn and narrows its own turn here, so two
 * cards shown in one turn both render, in call order.
 */

import { createPresentationTail } from "dsh-integration-ui";
import { figmaPresentation } from "../conversation/card-definition";

/** Every card one completed turn asked to show. */
export const FigmaTail = createPresentationTail(figmaPresentation);

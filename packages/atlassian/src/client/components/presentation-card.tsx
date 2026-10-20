/**
 * How one Atlassian card draws itself.
 *
 * The shared tail owns the card's material, its heading and its list; this says
 * what the heading counts, which items go in the list, and how the two kinds of
 * item Atlassian returns — issues and pages — are drawn side by side.
 */

import type { CardProvider } from "dsh-integration-ui";
import type { AtlassianPresentation } from "../../shared/presentation";
import { IssueItem } from "./issue-item";
import { PageItem } from "./page-item";

/**
 * What the card's heading says about its contents.
 * @param presentation - the card being drawn.
 * @returns "3 issues", "2 pages", or "5 of 42 issues" when more matched.
 */
const countLabel = (presentation: AtlassianPresentation): string => {
	const issues = presentation.items.filter(
		(item) => item.kind === "issue",
	).length;
	const pages = presentation.items.length - issues;
	const total = presentation.total;

	// A single kind of item can say how many matched; a mixed card would have to
	// say "of" twice, so it keeps the plain counts.
	if (total !== undefined && (issues === 0 || pages === 0)) {
		const noun = issues === 0 ? "page" : "issue";

		return `${presentation.items.length} of ${total} ${noun}${total === 1 ? "" : "s"}`;
	}

	return [
		issues === 0 ? "" : `${issues} issue${issues === 1 ? "" : "s"}`,
		pages === 0 ? "" : `${pages} page${pages === 1 ? "" : "s"}`,
	]
		.filter(Boolean)
		.join(" · ");
};

/** The Atlassian card, as the shared tail draws it. */
export const atlassianCard: CardProvider<AtlassianPresentation> = {
	callId: (presentation) => presentation.callId,
	title: (presentation) => presentation.title,
	count: countLabel,
	length: (presentation) => presentation.items.length,
	layout: (presentation) => presentation.layout,
	items: (presentation) =>
		presentation.items.map((item, index) =>
			item.kind === "issue" ? (
				<IssueItem
					key={item.issue.key ?? `issue-${index}`}
					issue={item.issue}
				/>
			) : (
				<PageItem key={item.page.id ?? `page-${index}`} page={item.page} />
			),
		),
};

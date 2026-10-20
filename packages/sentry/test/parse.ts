/**
 * The Sentry readers against real captures.
 *
 * Both documents below were captured from the live MCP server during the M3
 * spike — the shapes, the wording, and the ordering are what it actually sent.
 * The identifiers are replaced (organization, project, people, repository, issue
 * keys), because the capture came from a real account and this file ships with
 * the repository.
 *
 *   bun run test/parse.ts
 */

import {
	parseIssueDetail,
	parseIssueSearch,
} from "../src/host/presentation/parse";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
	checks += 1;

	if (!ok) failures += 1;

	console.log(
		`  ${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`,
	);
}

/** Captured: `search_issues({query: "is:unresolved", limit: 3, period: "30d"})`. */
const SEARCH = `# Search Results for "is:unresolved"

**Suggested presentation:** Cards work well for these issues, with status, assignee, and issue ID links visible.

**View these results in Sentry**:
https://acme.sentry.io/issues/?query=is%3Aunresolved
Please tell the user this dashboard link is available if they want to open the results in Sentry.

Found **3** issues:

## 1. [CHECKOUT-13P](https://acme.sentry.io/issues/CHECKOUT-13P)

**AxiosError: Request failed with status code 422**

- **Status**: unresolved
- **Users**: 6
- **Events**: 16
- **Assigned to**: Ada Lovelace
- **First seen**: 25 days ago
- **Last seen**: 2 minutes ago
- **Culprit**: \`/:locale/exchange/step2\`

## 2. [CHECKOUT-177](https://acme.sentry.io/issues/CHECKOUT-177)

**Error: Hydration failed because the server rendered HTML didn't match the client.**

- **Status**: unresolved
- **Users**: 0
- **Events**: 451
- **Assigned to**: Grace Hopper
- **First seen**: 21 days ago
- **Last seen**: 12 minutes ago
- **Culprit**: \`/:locale/reviews/:code\`

## 3. [CHECKOUT-19A](https://acme.sentry.io/issues/CHECKOUT-19A)

**AxiosError: Request failed with status code 502**

- **Status**: unresolved
- **Users**: 0
- **Events**: 2
- **First seen**: 4 days ago
- **Last seen**: 51 minutes ago
- **Culprit**: \`/:locale/cross-chain/:slug\`

## Next Steps

- Get more details about a specific issue: Use get_sentry_resource with the issue ID or issue URL
- Update issue status: Use the Sentry tool \`update_issue\` to resolve or assign issues
- View event counts: Use search_errors for aggregated statistics
`;

/** Captured: `get_sentry_resource({resourceType: "issue", resourceId: "CHECKOUT-13P"})`. */
const DETAIL = `# Issue CHECKOUT-13P in **acme**

**Description**: AxiosError: Request failed with status code 422
**Culprit**: /:locale/exchange/step2
**First Seen**: 2026-09-04T19:07:13.071Z
**Last Seen**: 2026-10-20T13:03:39.000Z
**Occurrences**: 35
**Users Impacted**: 11
**Status**: unresolved
**Substatus**: ongoing
**Assigned To**: Ada Lovelace (User)
**Issue Type**: error
**Issue Category**: error
**Platform**: javascript
**Project**: storefront
**URL**: https://acme.sentry.io/issues/CHECKOUT-13P

## Code Location

**Repository**: Acme / storefront
**Path**: src/packages/error-telemetry/captureAppException.ts
**Line**: 60
**Source**: https://gitlab.com/acme/storefront/blob/c379884d1b634b5b80c74468f81b94dff8cadddb/src/packages/error-telemetry/captureAppException.ts

## Suspect Commit

**SHA**: \`7c50a1e57b5a523da90bef0df35f5a6d87b772ed\`
**Message**: DEV-5977: Handle split 500 error codes on exchange creation
**Author**: Grace Hopper
**Source**: via SCM integration

## Event Details

**Event ID**: d346dc1b6344421784917c0c6edb9fea
**Type**: error
**Occurred At**: 2026-10-20T13:03:39.611Z

### Error

\`\`\`
AxiosError: Request failed with status code 422
\`\`\`

**Most Relevant Frame:**
─────────────────────
src/packages/error-telemetry/captureAppException.ts:60:26 (<anonymous>)

    57 │     if (!isAxiosError(error)) return Sentry.captureException(error, captureContext);
    58 │ 
    59 │     const errorContext = buildAxiosErrorContext(error);
  → 60 │     const captureError = new Error(errorContext.message || errorContext.name);
    61 │     captureError.name = errorContext.name;

**Full Stacktrace:**
────────────────
\`\`\`
src/exchange/store/Step2/ExchangeStep2Store.ts:414:16 (en)
          this.handleGenericCreateExchangeError(e, errorCode);
node_modules/mobx/src/core/action.ts:50:16 (res)
        return executeAction(actionName, autoAction, fn, ref || this, arguments)
src/packages/error-telemetry/captureAppException.ts:60:26 (<anonymous>)
    const captureError = new Error(errorContext.message || errorContext.name);
\`\`\`

### User

**user**: id:6877d2f7a7a94745b03529bb761964a9
**user.geo**: NL, Netherlands

### Tags

**browser**: Firefox 140.0
**browser.name**: Firefox
**environment**: prod
**errorCode**: expired_fixed_rate
**flow**: exchange-create
**handled**: yes
**level**: error
**os**: Linux
**release**: storefront@3.0.1
**transaction**: /:locale/exchange/step2
**url**: https://acme.example/exchange/step2

### Extra Data

Additional data attached to this event.

**error**: {
  "code": "ERR_BAD_REQUEST",
  "message": "Request failed with status code 422"
}

### Additional Context

These are additional context provided by the user when they're instrumenting their application.

**browser**
browser: "Firefox 140.0"
name: "Firefox"

## Response Notes

- Commit message issue reference: \`Fixes CHECKOUT-13P\` automatically closes the issue when the commit is merged.
- The stacktrace includes first-party application code and third-party code. First-party frames are usually the best starting point for triage.
`;

console.log("\n=== the search answer ===");
{
	const search = parseIssueSearch(SEARCH);

	check(
		"every listed issue is read",
		search.issues.length === 3,
		String(search.issues.length),
	);
	check(
		"the query the server echoed is kept",
		search.query === "is:unresolved",
		String(search.query),
	);
	check(
		"the dashboard link under its label is kept",
		search.dashboardUrl ===
			"https://acme.sentry.io/issues/?query=is%3Aunresolved",
		String(search.dashboardUrl),
	);
	check(
		"the count the answer claims is kept",
		search.total === 3,
		String(search.total),
	);

	const first = search.issues[0];

	check(
		"a row carries its id, link and title",
		first?.id === "CHECKOUT-13P" &&
			first?.url === "https://acme.sentry.io/issues/CHECKOUT-13P" &&
			first?.title === "AxiosError: Request failed with status code 422",
		JSON.stringify(first),
	);
	check(
		"its numbers are numbers, not the words around them",
		first?.events === 16 && first?.users === 6,
		`${String(first?.events)}/${String(first?.users)}`,
	);
	check(
		"its other fields keep the server's wording",
		first?.status === "unresolved" &&
			first?.assignee === "Ada Lovelace" &&
			first?.lastSeen === "2 minutes ago" &&
			first?.culprit === "/:locale/exchange/step2",
		JSON.stringify({
			status: first?.status,
			assignee: first?.assignee,
			lastSeen: first?.lastSeen,
		}),
	);
	check(
		"a row the server left unassigned carries no assignee",
		search.issues[2]?.assignee === undefined,
		String(search.issues[2]?.assignee),
	);
	check(
		"the prose after the list is not read as another issue",
		search.issues.every((issue) => issue.id.startsWith("CHECKOUT-")),
	);
}

console.log("\n=== the issue document ===");
{
	const detail = parseIssueDetail(DETAIL);

	check("the issue's own id is read", detail.id === "CHECKOUT-13P", detail.id);
	check(
		"the field block is read into fields",
		detail.description === "AxiosError: Request failed with status code 422" &&
			detail.status === "unresolved" &&
			detail.substatus === "ongoing" &&
			detail.assignee === "Ada Lovelace (User)" &&
			detail.project === "storefront" &&
			detail.platform === "javascript",
		JSON.stringify({
			status: detail.status,
			assignee: detail.assignee,
			project: detail.project,
		}),
	);
	check(
		"its counts are numbers",
		detail.occurrences === 35 && detail.users === 11,
		`${String(detail.occurrences)}/${String(detail.users)}`,
	);
	check(
		"the code location carries repository, path, line and link",
		detail.code?.path ===
			"src/packages/error-telemetry/captureAppException.ts" &&
			detail.code?.line === 60 &&
			detail.code?.repository === "Acme / storefront" &&
			(detail.code?.url ?? "").startsWith("https://gitlab.com/acme/storefront"),
		JSON.stringify(detail.code),
	);
	check(
		"the suspect commit carries sha, message and author",
		detail.suspect?.sha === "7c50a1e57b5a523da90bef0df35f5a6d87b772ed" &&
			detail.suspect?.author === "Grace Hopper" &&
			(detail.suspect?.message ?? "").startsWith("DEV-5977:"),
		JSON.stringify(detail.suspect),
	);
	check(
		"the tracker key inside the commit message is picked out",
		detail.suspect?.issueKey === "DEV-5977",
		String(detail.suspect?.issueKey),
	);
	check(
		"the event id and time are read",
		detail.eventId === "d346dc1b6344421784917c0c6edb9fea" &&
			detail.occurredAt === "2026-10-20T13:03:39.611Z",
		`${String(detail.eventId)}/${String(detail.occurredAt)}`,
	);
	check(
		"the exception's own line is the message",
		detail.message === "AxiosError: Request failed with status code 422",
		String(detail.message),
	);
	check(
		"the full stack trace is read, first-party frames included",
		(detail.stacktrace ?? "").includes(
			"src/exchange/store/Step2/ExchangeStep2Store.ts:414:16",
		) && (detail.stacktrace ?? "").includes("node_modules/mobx"),
		(detail.stacktrace ?? "").slice(0, 60),
	);
	check(
		"the stack trace stops at its own fence",
		!(detail.stacktrace ?? "").includes("### User") &&
			!(detail.stacktrace ?? "").includes("**browser**"),
	);
	check(
		"the tags are read as name and value pairs",
		detail.tags.some(
			(tag) => tag.name === "release" && tag.value === "storefront@3.0.1",
		) &&
			detail.tags.some(
				(tag) => tag.name === "environment" && tag.value === "prod",
			) &&
			detail.tags.length >= 10,
		String(detail.tags.length),
	);
	check(
		"the user and extra-data sections are not read as tags",
		detail.tags.every((tag) => !tag.name.startsWith("user")),
		JSON.stringify(detail.tags.map((tag) => tag.name)),
	);
	check("the whole document is kept for a raw view", detail.raw === DETAIL);
}

console.log("\n=== what a different answer does ===");

check(
	"a search that found nothing reads as an empty list",
	parseIssueSearch(
		'# Search Results for "is:resolved"\n\nFound **0** issues:\n',
	).issues.length === 0,
);
check(
	"an issue document with no fields still reads its id",
	parseIssueDetail("# Issue CHECKOUT-1 in **acme**\n").id === "CHECKOUT-1",
);

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) process.exit(1);

process.exit(0);

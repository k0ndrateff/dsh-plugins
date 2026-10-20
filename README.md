# dsh-plugins

DeepSeek Harness plugins: Jira and Confluence today, Sentry, GitLab and Figma
next. One plugin gives the agent the tools of a remote MCP server, signs in
through a real OAuth flow, and draws what it finds as cards and panels in the Web
Client instead of raw JSON — and the OAuth half is a library, because the harness
has none.

Built and verified against DSH `0.2.1-rc.2`.

## Packages

| Package | What it is |
|---|---|
| [`packages/atlassian`](packages/atlassian) | `dsh-atlassian-plugin` — Jira and Confluence |
| [`packages/sentry`](packages/sentry) | `dsh-sentry-plugin` — Sentry errors, with a card and a panel |
| [`packages/devkit`](packages/devkit) | `dsh-devkit-plugin` — the project's own lint, typecheck, test and build recipes |
| [`packages/mcp-oauth`](packages/mcp-oauth) | `dsh-mcp-oauth` — OAuth for MCP servers, and the authenticated bridge (a library, no bundle) |

The library carries RFC 9728/8414 discovery, RFC 7591 dynamic client
registration, PKCE over a loopback redirect, token lifetime with cross-process
refresh, and the MCP connection whose tokens keep changing. A plugin supplies a
provider profile and a credential-record key, and nothing else about OAuth. One
profile is one account, so a plugin can hold a work and a personal account of the
same provider side by side; a profile with no OAuth facts is a local MCP server
that needs no credentials at all.

Its conformance run resolves the endpoints of every provider on the roadmap,
registers a throwaway client wherever registration is open, and probes the token
endpoint to see which client authentication the server actually accepted:

```sh
cd packages/mcp-oauth && bun run test
```

That run needs the network and does register clients — at Atlassian, Sentry and
GitLab, once per run — so it is not one to put on a loop. The other two thirds of
the same command (the account grammar, the client-authentication policy, and the
bridge against a local MCP server) need nothing but bun.

Where this is going — Sentry, GitLab, Figma, and the digest — is written down in
[docs/roadmap.md](docs/roadmap.md). How to work in this
repository is [AGENTS.md](AGENTS.md).

## What you get

- **The agent's Atlassian tools.** The tools of `https://mcp.atlassian.com/v1/mcp`
  are published as ordinary harness tools named `mcp__atlassian__<tool>` —
  `searchJiraIssuesUsingJql`, `getJiraIssue`, `createJiraIssue`,
  `searchConfluenceUsingCql`, `getConfluencePage`, and everything else the server
  offers. They go through the normal tool pipeline: permissions, approvals,
  cancellation, session history.
- **Sign-in where you already are.** An **Atlassian** section in Settings, a
  `/atlassian` slash command (`status`, `login`, `logout`, `sync`), and a clear
  message when something needs a sign-in.
- **Terse tool rows.** A tool call reports one line — `searchJiraIssuesUsingJql ·
  found 5 issues · created >= -60d` — instead of reproducing the server's JSON.
  The full payload stays in the session log; the agent reads it, not the user.
- **Cards in the answer.** Ask "какие задачи взять сегодня?" and the agent calls
  `atlassian_present`, which shows one issue, a titled shortlist, a long list, or
  Confluence pages as a card under its answer. Every row links to the item and
  carries its status, assignee, priority, a colour-coded type, its estimate and
  one sentence of its description — see
  [Presentation cards](#presentation-cards).
- **The whole issue, one click away.** Clicking a card opens it in the harness's
  own right panel — description, comments, and the buttons that move the status
  or hand it to somebody else — instead of a browser tab — see
  [The side panel](#the-side-panel).

## Checks

The second bundle turns a project's own lint, typecheck, test and build commands
into one tool. The recipes live in `dsh-checks.json` at the project root, so the
repository owns the command and the agent only names it — this repository's own
file is a working example:

```json
{
  "checks": {
    "typecheck": { "run": "bun run typecheck", "parse": "tsc" },
    "lint":      { "run": "bunx biome check", "parse": "biome" },
    "test":      { "run": "bun test",         "parse": "vitest" }
  }
}
```

- **The `checks` tool.** `checks` runs every recipe in config order, `checks test`
  runs one. A command line is never accepted — that is what `bash` is for — and a
  name the project does not have comes back with the ones it does.
- **One line, then a card.** The tool group shows one terse line per call
  (`checks · test ✓ 48/48 tests · lint ✗ 3 errors`), and the card under the answer
  carries every check with its counts, its duration and its failures. A failure
  row is a `file:line` that opens that file in the harness's own panel.
- **`/checks`** lists the project's recipes, and **`/checks init`** drafts a book
  from the project's `package.json` scripts and prints it. Neither writes a file.
- **Parsers.** `tsc`, `biome` (either the JSON or the pretty reporter), `eslint`,
  `vitest`, `jest`, `pytest`, and `generic` — the exit code plus the tail of the
  output, which is what an unreadable tool gets. A recipe may set its own
  `timeoutMs`; the default is ten minutes.
- **Nothing is written to the project**, and each recipe runs through the
  harness's own shell seam, so the same sandbox and environment rules as `bash`
  apply.

## Sentry

The third bundle connects Sentry's remote MCP server through the same library the
Atlassian plugin uses: discovery, dynamic client registration, PKCE, and the
bridge that keeps the token fresh. `/sentry login` signs in, a **Sentry** section
in Settings shows the state, and the server's fifteen tools arrive as ordinary
harness tools (`mcp__sentry__search_issues`, `mcp__sentry__get_sentry_resource`,
`mcp__sentry__update_issue`, …).

On top of them:

- **`sentry_present`** — a card under the answer: a search or a list of issue ids,
  each row with its status, assignee, event and user counts, and a link to the
  issue. When the card is about one issue, the suspect commit rides along —
  short sha, message, author, and the tracker key the message names.
- **The issue panel** — click a row and the whole issue opens in the harness's own
  right panel: the exception and its full stack trace, the code location, the
  suspect commit, the tags, and the buttons that change it — **Resolve**,
  **Ignore**, **Reopen**, and **Assign** to `user:<id>` or `team:<slug>`.

Sentry's server answers its issue tools with Markdown meant for a person (it even
suggests a card), so the plugin reads that document rather than a JSON payload;
the readers live in `src/host/presentation/parse.ts` and are pinned by captures
from the live server.

## Configuration

The Atlassian bundle's patch inserts one row with defaults; override the row from
`$DSH_HOME/profiles/<name>/cordis.patch.yml`:

```yaml
- id: atlassian
  config:
    endpoint: https://mcp.atlassian.com/v1/mcp
    redirectPort: 8143
    debug: false
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://mcp.atlassian.com/v1/mcp` | MCP resource to connect to |
| `redirectPort` | `8143` | First loopback port tried for the OAuth callback; the next free port is used if it is taken |
| `debug` | `false` | Log the raw payload of every Atlassian tool result |

Disable either plugin without uninstalling it:

```yaml
- id: atlassian
  disabled: true
- id: devkit
  disabled: true
```

The devkit bundle takes no configuration of its own: what it runs is the
project's, and that lives in the project.

## Known limitations

- **The checks parsers are pinned to each tool's default reporter.** A custom
  format (`vitest --reporter=json`, a wrapped test runner) is not read; that
  check then reports its exit code and the tail of its output instead of a
  failure list, which is visible rather than silently empty.
- **`checks` runs its recipes one after another**, in the order the config lists
  them, and holds the call until the last one finishes. Watch mode and background
  jobs are not implemented yet.
- **A check's file opens at its beginning.** The card's seat in the turn tail
  carries a path and no line, so a failure row opens the file rather than jumping
  to the position the tool named.
- **Sign-in needs a human and a browser.** Atlassian enables no device-code
  grant for MCP clients, so there is no headless sign-in path.
- **Atlassian Cloud only.** The remote MCP server does not support Server or
  Data Center.
- **Admin settings can block you.** Domain allowlists, the API-token switch, and
  per-permission-group switches live in Atlassian Administration → Connectors →
  Atlassian MCP server. `delete_jira` and `manage_jira` are off by default.
- **Atlassian withholds `structuredContent`/`webUrl`** from clients it does not
  recognize by name (`clientInfo.name`), so the cards read the text payloads and
  build issue links from the site URL the plugin learns at connect time.
- **Cards cover known tool names.** A tool this plugin has never seen keeps the
  generic tool row; add its name to `TOOL_NAMES` in `src/shared/tool-names.ts`.
- **Tool results are capped** at 25 issues or pages per card; past four rows the
  card scrolls and its heading counts what it holds.
- **A Jira search reports no total.** The server paginates it with a cursor
  (`isLast`, `nextPageToken`) rather than a count, so a Jira card says "25
  issues" where a Confluence one can say "25 of 712 pages".
- **The one-sentence descriptions need a model route.** They use the turn's own
  provider and model; a deployment without the `llm` service, or a turn with no
  logged request header, gets cards without sentences rather than no cards.
- **The panel needs the right Sidebar.** Without that package the cards are still
  cards — a click just opens Atlassian in the browser instead.
- **The panel writes what the workflow allows.** A transition that opens a screen
  cannot be taken from the panel, because it has no form for the required fields;
  the assignee search matches on the site's own lookup, which needs two
  characters and a moment.
- **The `/dsh-atlassian` route is unauthenticated**, unlike `/api`. It is
  loopback-only, like the rest of the web server, but any local process can read
  the sign-in state, start or stop a sign-in, and now also transition an issue or
  reassign it, with the signed-in user's own permissions.
- **The card's copy is English and not routed through the client locale
  service**, which is registered per namespace at build time in TypeScript. The
  facts on a card are whatever the site says, in the site's own language.

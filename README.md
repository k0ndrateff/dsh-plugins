# dsh-plugins

DeepSeek Harness plugins: Jira and Confluence, Sentry, GitLab, Figma, and a daily
digest across them. One plugin gives the agent the tools of a provider, connects
it however that provider allows — an OAuth flow, a personal access token the user
pastes, or no credential at all for a server on the same machine — and draws what
it finds as cards and panels in the Web Client instead of raw JSON. The OAuth half
is a library, because the harness has none.

Built and verified against DSH `0.2.1-rc.2`.

## Packages

| Package | What it is |
|---|---|
| [`packages/atlassian`](packages/atlassian) | `dsh-atlassian-plugin` — Jira and Confluence |
| [`packages/sentry`](packages/sentry) | `dsh-sentry-plugin` — Sentry errors, with a card and a panel |
| [`packages/gitlab`](packages/gitlab) | `dsh-gitlab-plugin` — merge requests, review threads and pipelines |
| [`packages/figma`](packages/figma) | `dsh-figma-plugin` — a frame, its variables and its Code Connect mapping |
| [`packages/digest`](packages/digest) | `dsh-digest-plugin` — one read-only daily digest across the integrations above |
| [`packages/devkit`](packages/devkit) | `dsh-devkit-plugin` — the project's own lint, typecheck, test and build recipes |
| [`packages/mcp-oauth`](packages/mcp-oauth) | `dsh-mcp-oauth` — OAuth for MCP servers, and the authenticated bridge (a library, no bundle) |
| [`packages/integration-host`](packages/integration-host) | `dsh-integration-host` — the host-half shell every integration shares: endpoint patch, sign-in state, settings route, slash command (a library) |
| [`packages/integration-ui`](packages/integration-ui) | `dsh-integration-ui` — the browser-half shell: panel body, result card, tool row, settings section, stylesheet (a library) |

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

The other two libraries are the shared shell around an integration, so a new
provider writes only what is its own. `dsh-integration-host` owns the endpoint
patch, the sign-in state and the operations that change it, the settings route and
the slash command; a plugin supplies its provider profile, how its own server
names the account, and the paths its panel uses. `dsh-integration-ui` owns the
side-panel body — loading, failing, retrying, one write at a time — the result
card under the answer, the terse tool row, the settings card and the stylesheet
they are drawn with; a plugin supplies its payload, its drawing rules, and its own
tab kind. The settings card takes any of the three shapes of sign-in: a button that
starts a browser flow, a field the user pastes a credential into, or nothing at all
for a server that answers whoever is on the machine. Atlassian, Sentry, GitLab,
Figma and devkit are built on both.

Where this is going — the digest and cross-provider correlation — is written down
in [docs/roadmap.md](docs/roadmap.md). How to work in this repository is
[AGENTS.md](AGENTS.md).

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

## GitLab

The fourth bundle talks to GitLab's REST API with a personal access token the
user pastes into a **GitLab** section in Settings. It is not the MCP server, and
that is a recorded fact rather than a preference: GitLab's MCP endpoint is
switched off for a whole top-level group unless an Owner turns it on, and the
tokens it issues carry the single scope `mcp`, which no REST call accepts. A
token the user already has works everywhere, and the plugin keeps it in the
harness credential store under `dsh-gitlab/token`.

On top of the API:

- **`gitlab_present`** — a card under the answer: merge requests waiting for your
  review, your own, a search, one merge request's review findings, or its failed
  jobs. A row carries the reference, state, draft flag, author, reviewers and note
  count, and a finding row carries the file and line a reviewer asked about.
- **The merge request panel** — click a row and the whole merge request opens in
  the harness's own right panel, in four sections: **Overview** (branches,
  labels, description, approve), **Diff** (every changed file with its patch and
  per-file counts), **Discussions** (threads filtered to unresolved or to
  findings, with reply and resolve), and **Pipeline** (the jobs, and a failed
  job's trace read on demand).
- **`gitlab_review`** — comment, reply in a thread, resolve or reopen one, approve
  or unapprove. Every one of these changes somebody else's merge request, so the
  tool never sends one by itself: without `confirm` it answers with the exact text
  that would be posted, and the panel shows the same draft with a Send button
  beside it.

The readers live in `src/host/presentation/parse.ts` and are pinned by captures
from a live account — the shapes in `test/readers.ts` are what gitlab.com
actually answered, including the naming GitLab mixes (`web_url` beside
`detailed_merge_status`) and the fact that the discussions endpoint reports a
note's resolution on the note rather than on the thread.

## Figma

The fifth bundle talks to the **Dev Mode MCP server**, which the Figma desktop app
serves on `http://127.0.0.1:3845/mcp` while it is running. There is no sign-in and
no token: that server answers whoever is on the machine, so the plugin stores no
credential at all and the **Figma** section in Settings reports the connection
instead of asking for one. Its ten tools arrive as ordinary harness tools
(`mcp__figma__get_design_context`, `mcp__figma__get_variable_defs`,
`mcp__figma__get_screenshot`, …).

On top of them:

- **`figma_present`** — the agent names a node, a Figma link, or nothing for
  whatever is selected in the desktop app. The tool reads that node's structure,
  its variables and its Code Connect mapping, answers the model with those facts
  **as text**, and shows the person the frame itself. The picture deliberately
  never reaches the model: a screenshot costs far more context than the numbers
  beside it. When the model does need to look, it calls the server's own
  `mcp__figma__get_screenshot`.
- **The node panel** — the harness's right panel opens on the node by itself as
  soon as a call settles (a call replayed from the session log opens nothing), and
  from the card's own row at any time. It has three sections: **Frame** — the
  picture, the layer's type, size and position, and its direct children —
  **Tokens** — every variable the node uses, with the value Figma renders — and
  **Code Connect** — the component the node maps to and where it lives.
- **`/figma`** — `status`, `login` (which explains the switch to turn on),
  `logout` (which disconnects) and `sync` (which reconnects and re-publishes the
  tools).

`get_metadata` answers XML rather than JSON, so the reader walks it into layers;
`get_variable_defs` and `get_code_connect_map` answer objects keyed by name, and
`get_screenshot` answers an image block, which the panel fetches from the plugin's
own `/dsh-figma/screenshot` route rather than through the document. All of it is
pinned twice: `test/readers.ts` against recorded shapes, and `test/dry-run.ts`
against the running desktop app — the latter skips when it is not running.

## Digest

The sixth bundle is a *meta* one: it owns no provider and no credential, and it
never writes to an external system. It asks the integrations you already have
connected for the work that is waiting for you and lays the answers out as one
card — Jira issues in flight and overdue, Jira work assigned but not started,
merge requests waiting for your review, your own merge requests, new Sentry
errors, and (off by default) CodeRabbit's review notes.

The seam is a registry, not an import. `dsh-integration-host` declares what a
digest source is, `dsh-digest-plugin` provides the registry as `ctx.digestSources`,
and Atlassian, Sentry and GitLab each offer their blocks through a scoped
`ctx.inject` — so a deployment without the digest plugin simply never calls them,
and no plugin reaches into another's code. Each block's heading and its default
switch travel with the provider that owns it, which is why the settings card is
drawn from whatever is installed rather than from a list kept in one place.

- **The `digest` tool.** It takes no arguments: what a digest contains is the
  user's saved configuration, because a digest that changed shape every morning
  would be the one thing a digest must not be. It answers the model with text and
  the person with a card of blocks — each with its own heading, its own rows, or
  its own reason for being empty. "Nothing is waiting for your review" and
  "GitLab is not connected" are different lines, and the card never merges them.
- **A **Daily digest** section in Settings** — the blocks, the days of the week,
  the local time, the time zone and the row cap, plus **Show now**, which
  assembles one immediately and shows it in place so you can see what you are
  about to schedule.
- **`/digest`** — `now` assembles one; `on` and `off` bind and release the
  reminder **for the session they are typed in**; `time 09:30`, `timezone
  Europe/Moscow`, `days mon,tue,wed,thu,fri` and `blocks <id> on|off` change the
  same settings the card writes, and re-time every reminder that already exists.
- **The reminder is the harness's own.** Delivery goes through `ctx.schedule`, so
  the digest arrives in the session that asked for it, and a week away produces
  one digest rather than five — that is the schedule service's own behaviour.

Nothing about it is a model call: the collector reads the providers, and one
block failing is that block's `unavailable` line rather than a failed digest.
The one thing it does not do yet is the optional introductory sentence from the
model; [docs/roadmap.md](docs/roadmap.md) records why.

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

The GitLab bundle takes an instance root and a debug flag, and no port — there is
no browser flow to come back to:

```yaml
- id: gitlab
  config:
    endpoint: https://gitlab.com
    debug: false
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://gitlab.com` | Instance root; calls are made under its `/api/v4` |
| `debug` | `false` | Log the raw payload of every GitLab call |

The Figma bundle takes the Dev Mode server's address and the same debug flag:

```yaml
- id: figma
  config:
    endpoint: http://127.0.0.1:3845/mcp
    debug: false
```

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `http://127.0.0.1:3845/mcp` | The MCP server the Figma desktop app serves |
| `debug` | `false` | Log the raw payload of every Figma tool result |

Disable any plugin without uninstalling it:

```yaml
- id: atlassian
  disabled: true
- id: devkit
  disabled: true
- id: figma
  disabled: true
- id: digest
  disabled: true
```

The digest bundle takes no configuration of its own. What a digest contains and
when it arrives are *settings*, not deployment facts: they live in
`$DSH_HOME/digest/settings.json`, written by the settings card and by `/digest`,
and the file is read forgivingly — a hand-edited typo falls back to its default
rather than taking the plugin down.

```json
{
  "time": "09:00",
  "days": [1, 2, 3, 4, 5],
  "timeZone": "Europe/Moscow",
  "blocks": { "coderabbit": true },
  "limit": 10
}
```

| Field | Default | Meaning |
|---|---|---|
| `time` | `09:00` | Local wall-clock time the digest is delivered |
| `days` | Monday–Friday | JS weekday numbers, `0` = Sunday; all seven becomes a daily rule, anything narrower a weekly one |
| `timeZone` | the machine's zone | The IANA zone `time` is read in |
| `blocks` | each provider's own default | Saved switches by block id; a block with no entry keeps its default |
| `limit` | `10` | Rows one block may contribute (5, 10, 15 or 25) |

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
- **The local routes are unauthenticated** (`/dsh-atlassian`, `/dsh-gitlab`),
  unlike `/api`. They are loopback-only, like the rest of the web server, but any
  local process can read the sign-in state, start or stop a sign-in, store a
  token, and act on an issue or a merge request with the signed-in user's own
  permissions.
- **GitLab signs in with a token, not a browser.** A personal access token with
  the `api` scope is required; `read_api` covers the reads, and the writes
  (comment, reply, resolve, approve) need `api`.
- **GitLab's MCP server needs a group switch.** It is off unless an Owner of the
  top-level group turns on **Settings → General → Permissions and group features
  → MCP client access → Allow connection to GitLab**, and its tokens work only at
  the MCP endpoint. That is why this plugin drives REST instead.
- **A job's trace is cut to its last 64 KiB.** A failed job's log runs up to the
  failure, so the end is what is kept; the panel says so and links to the job.
- **A merge request list carries no pipeline status.** GitLab's list endpoint does
  not send `head_pipeline`, so a list row shows the state and the reviewers but
  no pipeline badge; the panel's Pipeline tab reads it from the merge request
  itself.
- **Figma's desktop app has to be running.** The Dev Mode MCP server lives inside
  it, so the plugin is dormant otherwise; the settings card says which switch to
  turn on rather than pretending the connection is broken.
- **Figma is connected locally only.** The remote `mcp.figma.com/mcp` server is
  deliberately not wired up: its dynamic registration answers `403` to anonymous
  callers, its single scope `mcp:connect` is not one a self-made Figma app can
  request, and Figma's own documentation says only catalog clients may connect.
  The transport seam is there — the profile simply has no OAuth facts — and
  [docs/roadmap.md](docs/roadmap.md) records what was measured.
- **Code Connect shows what the file already has.** The panel reads mappings; it
  does not create them. A node with no mapping says so, and the mapping is made in
  Figma or with the Code Connect CLI.
- **The panel opens by itself only for a live call.** A call the page watched run
  navigates the right Sidebar to its node; one replayed from the session log
  opens nothing, so scrolling back through a conversation never moves a panel.
- **The frame's picture is refetched, not cached.** It is asked for again every
  time the panel loads its document, because the file may have changed since.
- **A node Figma has no image for says so** in place of the picture, rather than
  leaving the browser's broken-image mark in the panel.
- **The card's copy is English and not routed through the client locale
  service**, which is registered per namespace at build time in TypeScript. The
  facts on a card are whatever the site says, in the site's own language.
- **A digest block looks back one day.** The window is 24 hours whatever the
  delivery cadence, so a weekly digest reports the last day rather than the last
  week; the block's own heading says "in the last 24 hours" instead of implying
  otherwise.
- **The digest's reminder belongs to a session.** The harness stores reminders
  against the session that created them, so `/digest on` binds one where you type
  it — the settings card configures *what* and *when* but has no session to bind
  to, and says so.
- **CodeRabbit's block matches on the note's author.** GitLab's list endpoints do
  not expose review comments, so the block reads the discussions of the user's
  most recently updated merge requests and keeps the notes whose author name
  matches `coderabbit`. It is off by default, and its rows link to the note.
- **The digest has no model-written introduction yet.** The roadmap's optional
  "вводная фраза от модели" would need a model route the host half can call
  outside a turn; the collector is deliberately deterministic until that exists.
- **A digest does not correlate across providers.** "This Sentry error came from
  that merge request" is the next milestone, not this one: today a block reports
  what one provider answered.
- **The digest's `/dsh-digest` route is unauthenticated** like the other
  integrations' routes: loopback-only, but any local process can read the
  settings, change them, or assemble a digest. It cannot write anywhere.

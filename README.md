# dsh-atlassian-plugin

Jira and Confluence Plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
One bundle gives the agent the tools of Atlassian's remote MCP server, signs in
through a real OAuth flow, and draws Jira issues and Confluence pages as cards in
the Web Client instead of raw JSON.

Built and verified against DSH `0.2.1-rc.2`.

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

## Authentication

The Atlassian MCP endpoint only accepts OAuth, so this plugin implements the
authorization-code flow with PKCE against Atlassian's own authorization server.
There is **no Atlassian app to register and no client secret to paste**: the
plugin registers itself as a public client through dynamic client registration
(RFC 7591) the first time you sign in. Tokens are stored in the harness
credential store and refreshed under its cross-process lock, so two harness
processes cannot rotate the same refresh token.

Sign in either way:

1. **Settings → Atlassian → “Sign in with Atlassian”** — the plugin opens your
   browser on Atlassian's consent page and follows the attempt until it settles.
2. **`/atlassian login`** in the composer.

Either way the browser opens Atlassian's authorize page, you approve for your
site, a loopback listener on `http://127.0.0.1:8143/callback` receives the code,
and the token lands in the credential store. The agent's tools work immediately
afterwards — no restart.

Scopes requested: read and write for Jira and Confluence, plus `offline_access`
so a refresh token is issued. Whatever Atlassian does not advertise is dropped
automatically, so the same plugin works against both endpoint generations.

## Endpoint generations

Atlassian runs two generations of the same server, and they are separate OAuth
resources — a token for one does not work for the other:

| | `/v1/mcp` (default) | `/v2/mcp` |
|---|---|---|
| Authorization server | `mcp.atlassian.com` | `auth.atlassian.com` |
| Scope vocabulary | classic (`read:jira-work`) | `*:agent-interface` |

The plugin discovers the authorization server from the resource's own metadata,
so both work. To move to the newer generation, set `endpoint` to
`https://mcp.atlassian.com/v2/mcp` and sign in again.

## Presentation cards

`atlassian_present` is the one tool that is not an Atlassian server tool. It
resolves what to show — issue keys, page ids, a JQL query, or a CQL query — answers
the model with a text summary, and records a card for the turn:

| Layout | When it fits |
|---|---|
| `single` | One item, with its full detail. |
| `compact` | Two to four items, under an optional title such as "План на день". |
| `list` | Five or more items: tighter rows, one line of summary each. |

`auto` (the default) picks by item count, and one card may mix Jira issues with
Confluence pages — that is what lets "plan for today" be a single card.

What one row carries:

- **A link.** The whole card is clickable: the title anchors a stretched overlay,
  so the summary, the badges and the empty space beside them all open the issue
  or the page in the browser.
- **A coloured type.** The issue type is a chip on the harness's own palettes —
  a bug is red, a task blue, a story green, an epic the one solid chip — matched
  by name in either language, and neutral when the name means nothing to this
  version.
- **The facts that decide.** Status, priority (its own colour), assignee, and the
  estimate exactly as Jira states it (`3d 4h`, `4ч`).
- **One sentence of description.** See below.

A card longer than four rows **scrolls** instead of growing, and its heading
counts what it holds — `5 of 42 issues` when the server reported a total.

The card renders **under the closing text of the turn**, outside the collapsible
tool group. That seat is shared with the harness's own `present` cards, and it is
the right one because the card is an answer-shaped summary rather than a step in
the work. The tool call itself keeps the generic tool row, so nothing is shown
twice.

### The one-sentence description

A Jira description is a page of context and a Confluence body is more, so neither
reaches the card. `atlassian_present` reads them, asks the conversation's own
model for one sentence per item, and records only the sentences.

The pass is a single auxiliary `ctx.llm.stream` call for the whole card, on the
route the current turn logged, with `temperature: 0`, a 20-second deadline and
the tool call's own cancellation. It is best-effort by construction: no `llm`
service, no readable route, a slow or failing provider — each of those leaves the
card without its sentences and nothing else changes. The nested call never enters
the session log, and the raw descriptions are dropped when the card is projected,
so they are not persisted either.

Mechanically the card writes **nothing extra to the session**. The tool publishes
it as the tool result's `presentationMeta`, which the harness persists on the
result; the browser half registers a `ConversationNodeDefinition` that folds
those results into turn-scoped data, and a seat in `conversation.chat.turnTail`
draws them. Because the card is narrowed out of the persisted result, replaying
the session log reproduces it exactly — the same approach `ui-schedule` uses for
its created-task card, and the reason this plugin needs no new durable event
type.

## Architecture

The plugin is one package with two faces, matching how the harness composes
plugins. `src/host` runs in the harness process; `src/client` runs in the page.

```
src/
├── shared/                     contracts both faces must agree on
│   ├── meta.ts                 the tool-result contract a card renders
│   ├── presentation.ts         the card payload, and its validator
│   ├── status.ts               the status document the settings card reads
│   ├── tone.ts                 which colour a type or priority earns
│   └── tool-names.ts           known Atlassian tools, and the public-name rule
├── host/
│   ├── index.ts                apply(): what the plugin registers
│   ├── config.ts               configuration and its defaults
│   ├── state.ts                process-local state shared by the surfaces
│   ├── auth.ts                 sign-in, sign-out, and the status view
│   ├── browser.ts              opening the user's browser
│   ├── json.ts                 the JSON-safe credential payload helper
│   ├── log.ts                  logger and error text
│   ├── net.ts                  HTTP helpers with deadlines
│   ├── oauth/
│   │   ├── discovery.ts        RFC 9728 / 8414 discovery, scope negotiation
│   │   ├── server.ts           registration, token exchange, token fields
│   │   ├── loopback.ts         the redirect listener
│   │   └── flow.ts             the PKCE flow registered on the seam
│   ├── store/grant.ts          the credential record and token refresh
│   ├── mcp/bridge.ts           the MCP connection and tool publishing
│   ├── presentation/
│   │   ├── extract.ts          tool result -> card data
│   │   └── gist.ts             one sentence per item, written by the model
│   ├── tools/present.ts        atlassian_present: the card the agent shows
│   └── surface/
│       ├── command.ts          the /atlassian command
│       └── http.ts             the loopback API the settings card calls
└── client/
    ├── index.ts                the client plugin: slot registrations
    ├── components/             settings card, tool row, presentation cards
    ├── conversation/           the node definition behind a presentation
    ├── styles/                 vanilla-extract theme, rules, and injection
    ├── host-api.ts             the settings card's calls to the host
    └── plugin-id.ts            the id the module system keys on
```

Two design notes worth knowing before changing things:

- **`src/host`, not the stock MCP client.** `dsh-mcp-client` takes its HTTP
  headers from static configuration, and an OAuth access token changes over the
  process's life. So the bridge owns its own transport with an `authProvider`
  that is asked for the token before every request — a refresh needs no
  reconnect — and publishes each discovered tool through the harness's own MCP
  adapter, so results keep the canonical shape.
- **A named route, not a remote namespace.** The card reaches the host over
  `/dsh-atlassian` on the same loopback origin. A generated Typert remote
  namespace would also work but needs a build step the harness does not publish;
  a named route is structured JSON in both directions and needs none.
- **vanilla-extract, not the harness's CSS Modules.** In-repo packages compile
  `.module.css` with a preset that is not published, so an out-of-tree plugin has
  to bring its own pipeline. vanilla-extract gives the same result — static CSS,
  typed tokens, no runtime — and keeps the single-file constraint above.

## Build

```sh
npm install
npm run build        # writes lib/index.js and lib/client.js
npm run typecheck    # both halves, against the harness's published types
```

`build.mjs` uses esbuild for both faces. The browser face is wrapped in the
client module system's lazy factory format — a classic script registering
`window.__ModuleLoader__.load({ id, factory })` — which is why it needs no
TypeScript-to-browser pipeline of its own. Everything except the harness's shared
module table (`react`, `@deepseek-ai/dsh-client-ui-primitives`, …) is inlined.

Styles are authored in [vanilla-extract](https://vanilla-extract.style): each
rule is compiled to static CSS at build time, and the components import class
names. `theme.css.ts` declares the harness's design tokens
(`--dsw-radius-xl`, `--dsw-alias-settings-card-fill`, …) as a typed contract, so
a mistyped token fails the build instead of silently losing a colour. The build
runs vanilla-extract twice: once to produce the stylesheet, once to compile the
components with that CSS substituted into the bundle as a string. That is
deliberate — the client module system serves exactly one artifact per package
(`client.js`), so a separate `.css` file would never reach the page — and it
means the bundle carries no style-injection runtime, only the class names and
`styles-runtime.ts`, which tags the `<style>` element with the plugin id so the
rules leave when the plugin is turned off.

## Configuration

The bundle's patch inserts one row with defaults; override the row from
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

Disable the plugin without uninstalling it:

```yaml
- id: atlassian
  disabled: true
```

## Install

```sh
npm install && npm run build

DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop add /path/to/dsh-jira-plugin
```

The install links the checkout and appends `dsh-atlassian` to the profile's
`dsh.profile.bundles`. Remove it with
`"$DSH" plugin --profile desktop remove dsh-atlassian`.

Because the install is a link, the host half is read at process start: after
changing `src/host`, run `npm run build` and restart the app. Only the profile
patch reloads live.

## Test

```sh
npm test                      # the dry run, with bun
npm run typecheck             # both halves
```

`test/dry-run.ts` covers two things. First the pure parts: the credential record
rehydrates from plain JSON, a card payload this version cannot read is skipped
rather than drawn wrongly, an estimate in seconds reads like Jira's own, model
output is parsed back into one sentence per item, an unknown type or priority is
neutral and a Cyrillic `Р4` is not, and one MCP search result becomes cards with
links — including the site-relative Confluence URL, which is resolved against the
wiki rather than the site root.

Then it drives the OAuth machinery against Atlassian's real endpoints with a fake
harness context: metadata discovery, a throwaway client registration, the
authorize URL, the consent page rendering, the loopback callback rejecting a
forged `state`, the stored record, and cancellation — for both endpoint
generations. It never completes consent.

While the harness is running, the host half also answers on loopback:

```sh
curl http://127.0.0.1:55236/dsh-atlassian/status
```

## Known limitations

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
- **The `/dsh-atlassian` route is unauthenticated**, unlike `/api`. It is
  loopback-only, like the rest of the web server, but any local process can read
  the sign-in state and start or stop a sign-in.
- **The card's copy is English and not routed through the client locale
  service**, which is registered per namespace at build time in TypeScript. The
  facts on a card are whatever the site says, in the site's own language.

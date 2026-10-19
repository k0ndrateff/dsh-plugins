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
- **Cards, not JSON.** A Jira search or issue read renders a card per issue with
  its key, summary, status, priority, assignee, and a link to Jira; Confluence
  results render as titled links. The cards use the harness's own UI kit and
  design tokens, so they look like the rest of Settings.

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

## Architecture

The plugin is one package with two faces, matching how the harness composes
plugins. `src/host` runs in the harness process; `src/client` runs in the page.

```
src/
├── shared/                  types and constants both faces must agree on
│   ├── meta.ts              the tool-result contract a card renders
│   ├── status.ts            the status document the card reads
│   └── tool-names.ts        known Atlassian tools, and the public-name rule
├── host/
│   ├── index.ts             apply(): what the plugin registers
│   ├── config.ts            configuration and its defaults
│   ├── state.ts             process-local state shared by the surfaces
│   ├── auth.ts            the operations every caller shares
│   ├── oauth/
│   │   ├── discovery.ts     RFC 9728 / 8414 discovery, scope negotiation
│   │   ├── server.ts        registration and the token endpoint
│   │   ├── loopback.ts      the redirect listener
│   │   └── flow.ts          the PKCE flow registered on the seam
│   ├── store/grant.ts       the credential record and token refresh
│   ├── mcp/bridge.ts        the MCP connection and tool publishing
│   ├── presentation/extract.ts   tool result -> card data
│   └── surface/
│       ├── command.ts       the /atlassian command
│       └── http.ts          the loopback API the card calls
└── client/
    ├── index.ts             the client plugin: slot registrations
    ├── settings-section.tsx  the Atlassian settings card
    ├── tool-row.tsx          the Jira/Confluence result cards
    ├── theme.css.ts         the harness's design tokens as a typed contract
    ├── styles.css.ts        the stylesheet, authored in vanilla-extract
    ├── styles-runtime.ts    puts the compiled CSS into the page
    ├── host-api.ts          the card's calls to the host
    └── strings.ts           English and Russian copy
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
npm test                      # build, then drive the OAuth machinery live
node test/dry-run.mjs         # against the already-built lib/
```

`test/dry-run.mjs` runs the host half against Atlassian's real endpoints with a
fake harness context. It discovers metadata, registers a throwaway OAuth client,
builds the authorize URL, checks the consent page renders, proves the loopback
callback rejects a forged `state`, verifies the stored record survives a JSON
round trip (the credential store refuses a value it cannot represent), and
cancels the attempt — for both endpoint generations. It never completes consent.

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
- **Tool results are capped** at 25 issues or pages per card, with a text
  excerpt as the fallback.
- **The `/dsh-atlassian` route is unauthenticated**, unlike `/api`. It is
  loopback-only, like the rest of the web server, but any local process can read
  the sign-in state and start or stop a sign-in.
- **The card's copy is not routed through the client locale service.** That
  service is registered per namespace at build time in TypeScript; this plugin
  keeps an explicit two-language `strings.ts` instead, which needs no build-time
  declaration merging.

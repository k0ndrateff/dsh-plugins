# dsh-mcp-oauth

OAuth for MCP servers, and the authenticated bridge — the part DeepSeek Harness
does not have, which is why an integration has to bring it.

Part of **[DeepSeek Harness Plugins](https://github.com/k0ndrateff/dsh-plugins)**
by [@k0ndrateff](https://github.com/k0ndrateff) — Jira, Confluence, Sentry, GitLab
and Figma integrations for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus a digest,
a cross-provider correlation and project checks built on top of them.

**This is a library, not a plugin.** Installing it adds a dependency and nothing
else: `dsh plugin add dsh-mcp-oauth` would show you nothing in the app. To use Jira,
Sentry, GitLab or Figma, install `dsh-atlassian-plugin`, `dsh-sentry-plugin`,
`dsh-gitlab-plugin` or `dsh-figma-plugin` — each already bundles this one.

## What it carries

- RFC 9728 protected-resource discovery and RFC 8414 authorization-server metadata
- RFC 7591 dynamic client registration, with the client-authentication method the
  server's own answer decides
- PKCE S256 over a loopback redirect, with the next free port chosen per attempt
- token lifetime across processes, refreshed under a cross-process lock
- a credential record per `scope + instance`, so two accounts of one provider live
  side by side
- a bridge that connects over MCP with a token that keeps changing, and publishes
  whatever tools the server offers as ordinary harness tools
- profiles with no OAuth facts at all, for a server on the same machine

The host half is node code; another package takes only `import type` from it.
`dsh-mcp-oauth/tool-name` is the client-safe entry, for the one rule both halves
need — how a published tool is named.
